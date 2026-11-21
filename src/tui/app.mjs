import { splitSystemOutput } from './output.mjs';
import { UIStore } from './store.mjs';
import { getTheme, SPIN_FRAMES } from './themes.mjs';
import { stripAnsi, shortTextPreview, formatElapsed } from './format.mjs';
import { selectViewportItems } from './viewport.mjs';
import { confirmationViewport } from './confirmation-view.mjs';
import { formatEventPreview } from './event-display.mjs';
import { transcriptViewport } from './transcript-view.mjs';
import { layoutForWidth } from './layout.mjs';
import { runSerialInputs } from './turn-runner.mjs';
import { normalizeInputEvent, splitSubmittedInput, editDelete, moveCursor, mouseWheelSteps } from './input-events.mjs';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runAgentTurn } = require('../core/agent');
const { parseAgentResponse } = require('../core/prompts');
const { getProviderBrand } = require('../providers/brand');
const { modelDisplayId } = require('../providers/model-id');
const { handleLocalCommand, SLASH_COMMANDS } = require('../cli/commands');
const { countTokens, estimateContextTokens, getContextLimit } = require('../config');
const {
  loadOrCreateSessionState,
  applyLoadedState,
  consumeBackgroundResult,
  listBackgroundResults,
} = require('../utils/sessionStorage');
const { appendTranscriptEntry } = require('../utils/transcriptStorage');
const { pushAction } = require('../cli/print');
const {
  APP_NAME,
  DEFAULT_MODEL_KEY,
  MODELS,
} = require('../config');
const { normalizeLanguage, t } = require('../i18n');

const h = React.createElement;
function getTuiLang() {
  return normalizeLanguage(global.__zynCurrentLanguage || 'en');
}
function uiText(en, es) {
  return getTuiLang() === 'es' ? es : en;
}
const SPIN_MS = 80;


let T = getTheme('dark');
let globalStore = null;
global.__zynApplyTheme = (name) => {
  T = getTheme(name);
  if (globalStore) {
    globalStore.themeVersion++;
    globalStore._emit();
  }
};

function useStore(store) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    store.on('update', handler);
    return () => store.off('update', handler);
  }, [store]);
}

function useDimensions() {
  const { stdout } = useStdout();
  const [dims, setDims] = useState({ width: stdout?.columns || 100, height: stdout?.rows || 40 });
  useEffect(() => {
    if (!stdout) return;
    const handler = () => {
      setDims({ width: stdout.columns || 100, height: stdout.rows || 40 });
    };
    stdout.on('resize', handler);
    return () => stdout.off('resize', handler);
  }, [stdout]);
  return dims;
}


function parseInline(text) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))|((?:https?:\/\/)[^\s<>"']+)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ t: 'text', v: text.slice(lastIndex, match.index) });
    }
    if (match[2]) parts.push({ t: 'bold', v: match[2] });
    else if (match[4]) parts.push({ t: 'italic', v: match[4] });
    else if (match[6]) parts.push({ t: 'italic', v: match[6] });
    else if (match[8]) parts.push({ t: 'code', v: match[8] });
    else if (match[10] && match[11]) parts.push({ t: 'link', text: match[10], url: match[11] });
    else if (match[12]) parts.push({ t: 'link', text: match[12], url: match[12] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ t: 'text', v: text.slice(lastIndex) });
  }
  if (parts.length === 0) parts.push({ t: 'text', v: text });
  return parts;
}


function normalizeAssistantDisplayText(text) {
  const raw = String(text || '');
  let trimmed = raw.trim();
  if (!trimmed) return raw;

  const parsed = parseAgentResponse(trimmed);
  if (parsed?.type === 'tool') {
    return '';
  }
  if (parsed?.type === 'final' && typeof parsed.content === 'string' && parsed.content.trim()) {
    const content = parsed.content.trim();
    if (content.startsWith('{') || content.startsWith('[')) return '';
    return content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return trimmed.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function makeOsc8Link(text, url) {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function InlineLine({ text, color }) {
  const parts = parseInline(text);
  const base = color || T.text;
  return h(Box, { flexWrap: 'wrap' },
    ...parts.map((p, i) => {
      if (p.t === 'bold') return h(Text, { key: String(i), color: base, bold: true }, p.v);
      if (p.t === 'italic') return h(Text, { key: String(i), color: T.textMuted, italic: true }, p.v);
      if (p.t === 'code') return h(Text, { key: String(i), color: T.cyan, backgroundColor: T.codeBg }, ' ' + p.v + ' ');
      if (p.t === 'link') return h(Box, { key: String(i), flexWrap: 'wrap' },
        h(Text, { color: T.accent, underline: true }, makeOsc8Link(p.text, p.url)),
        h(Text, { color: T.textMuted }, ' (' + makeOsc8Link(p.url, p.url) + ')'),
      );
      return h(Text, { key: String(i), color: base }, p.v);
    }),
  );
}

function parseMarkdownBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let paragraph = [];
  let i = 0;

  const flushParagraph = () => {
    const value = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (value) blocks.push({ type: 'paragraph', text: value });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      flushParagraph();
      const lang = fenceMatch[1] || '';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      flushParagraph();
      blocks.push({ type: 'header', level: hMatch[1].length, text: hMatch[2].trim() });
      i += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    const tableCandidate = line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]);
    if (tableCandidate) {
      flushParagraph();
      const table = [line];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        table.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'table', rows: table });
      continue;
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      flushParagraph();
      const indent = Math.floor(ulMatch[1].length / 2);
      const items = [];
      while (i < lines.length) {
        const current = lines[i].match(/^(\s*)[-*+]\s+(.+)/);
        if (!current) break;
        items.push({ ordered: false, indent: Math.floor(current[1].length / 2), text: current[2].trim() });
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)/);
    if (olMatch) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const current = lines[i].match(/^(\s*)\d+[.)]\s+(.+)/);
        if (!current) break;
        items.push({ ordered: true, indent: Math.floor(current[1].length / 2), text: current[2].trim() });
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return blocks;
}

function splitLongToken(token, limit) {
  const parts = [];
  const text = String(token || '');
  for (let i = 0; i < text.length; i += limit) parts.push(text.slice(i, i + limit));
  return parts.length ? parts : [''];
}

function wrapText(text, maxWidth) {
  const limit = Math.max(8, maxWidth || 80);
  const lines = [];
  const raw = String(text || '').split('\n');

  for (const rawLine of raw) {
    if (!rawLine.length) {
      lines.push('');
      continue;
    }

    const tokens = rawLine.match(/\s+|[^\s]+/g) || [rawLine];
    let current = '';

    const flush = () => {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
    };

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (!current) continue;
        if ((current + token).length <= limit) {
          current += token;
        } else {
          flush();
        }
        continue;
      }

      const chunks = token.length > limit ? splitLongToken(token, limit) : [token];
      for (const chunk of chunks) {
        if (!current) {
          current = chunk;
          continue;
        }
        if ((current + chunk).length <= limit) {
          current += chunk;
        } else {
          flush();
          current = chunk;
        }
      }
    }

    flush();
  }

  return lines.length ? lines : [''];
}

function splitTableCells(row) {
  const raw = String(row || '').trim();
  const cells = raw.startsWith('|') && raw.endsWith('|') ? raw.slice(1, -1).split('|') : raw.split('|');
  return cells.map(cell => cell.trim()).filter((_, idx) => true);
}

function CodeBlock({ lang, code, width }) {
  const maxW = Math.max(24, Math.min((width || 80) - 4, 120));
  const inner = Math.max(10, maxW - 4);
  const langLabel = lang ? ' ' + lang + ' ' : '';
  const topBar = '┌' + (langLabel ? '─' + langLabel : '') + '─'.repeat(Math.max(0, maxW - 2 - langLabel.length)) + '┐';
  const botBar = '└' + '─'.repeat(maxW - 2) + '┘';
  const codeLines = String(code || '').split('\n');

  return h(Box, { flexDirection: 'column', marginTop: 0, marginBottom: 0 },
    h(Text, { color: T.borderLight }, topBar),
    ...codeLines.flatMap((ln, i) => {
      const wrapped = wrapText(ln, inner);
      return wrapped.map((part, partIdx) => h(Box, { key: `${i}-${partIdx}` },
        h(Text, { color: T.borderLight }, '│ '),
        h(Text, { color: T.cyan }, part.padEnd(inner)),
        h(Text, { color: T.borderLight }, ' │'),
      ));
    }),
    h(Text, { color: T.borderLight }, botBar),
  );
}

function MarkdownContent({ text, width, live }) {
  const contentWidth = Math.max(24, (width || 80) - 8);
  if (live) {
    const lines = text.split('\n');
    return h(Box, { flexDirection: 'column' },
      ...lines.map((line, i) =>
        h(Text, { key: String(i), color: T.text, wrap: 'wrap' }, line || ' '),
      ),
    );
  }
  const blocks = parseMarkdownBlocks(text);
  return h(Box, { flexDirection: 'column' },
    ...blocks.map((block, i) => {
      switch (block.type) {
        case 'code':
          return h(CodeBlock, { key: String(i), lang: block.lang, code: block.code, width });
        case 'header':
          return h(Box, { key: String(i), marginTop: block.level === 1 ? 1 : 0 },
            h(Text, { color: T.accent, bold: true }, block.text),
          );
        case 'list': {
          return h(Box, { key: String(i), flexDirection: 'column', paddingLeft: 0 },
            ...block.items.map((item, idx) => {
              const bullet = item.ordered ? `${idx + 1}.` : '•';
              const indent = '  '.repeat(item.indent || 0);
              const wrapped = wrapText(item.text, Math.max(12, contentWidth - indent.length - 4));
              return h(Box, { key: String(idx), flexDirection: 'column' },
                h(Box, { flexWrap: 'wrap' },
                  h(Text, { color: T.textMuted }, indent + bullet + ' '),
                  h(InlineLine, { text: wrapped[0] || item.text }),
                ),
                ...wrapped.slice(1).map((part, partIdx) => h(Box, { key: String(partIdx), paddingLeft: indent.length + 2 }, h(Text, { color: T.textMuted }, part))),
              );
            }),
          );
        }
        case 'paragraph': {
          const wrapped = wrapText(block.text, contentWidth);
          return h(Box, { key: String(i), flexDirection: 'column', marginBottom: 0 },
            ...wrapped.map((part, idx) => h(InlineLine, { key: String(idx), text: part })),
          );
        }
        case 'quote': {
          const wrapped = wrapText(block.text, contentWidth - 2);
          return h(Box, { key: String(i), marginLeft: 1, flexDirection: 'column' },
            ...wrapped.map((part, idx) => h(Box, { key: String(idx) },
              h(Text, { color: T.textMuted }, '> '),
              h(InlineLine, { text: part, color: T.textMuted }),
            )),
          );
        }
        case 'hr':
          return h(Text, { key: String(i), color: T.borderLight }, '─'.repeat(Math.max(10, Math.min(width || 80, 70))));
        case 'table': {
          const rows = block.rows.map(row => splitTableCells(row)).filter((row, idx) => idx === 0 || !row.every(cell => /^:?-{3,}:?$/.test(cell)));
          const widths = [];
          for (const row of rows) {
            row.forEach((cell, idx) => {
              widths[idx] = Math.max(widths[idx] || 0, cell.length);
            });
          }
          const maxTableWidth = Math.max(24, (width || 80) - 8);
          const gaps = Math.max(0, widths.length - 1) * 3;
          const total = widths.reduce((a, b) => a + b, 0) + gaps;
          const scale = total > maxTableWidth ? Math.max(0.4, (maxTableWidth - gaps) / Math.max(1, widths.reduce((a, b) => a + b, 0))) : 1;
          const fitted = widths.map(w => Math.max(6, Math.floor(w * scale)));
          const lines = rows.map(row => row.map((cell, idx) => {
            const cellWidth = fitted[idx] || 6;
            const value = String(cell || '').slice(0, cellWidth);
            return value.padEnd(cellWidth);
          }).join(' │ '));
          return h(Box, { key: String(i), flexDirection: 'column' },
            ...lines.map((line, rowIdx) => h(Text, { key: String(rowIdx), color: rowIdx === 0 ? T.accent : T.textMuted, wrap: 'wrap' }, line)),
          );
        }
        default:
          return null;
      }
    }),
  );
}

function Banner({ model, resumed, width, cwd }) {
  const { frameWidth } = layoutForWidth(width);
  const sessionLabel = resumed ? uiText('session resumed', 'sesión reanudada') : uiText('new session', 'sesión nueva');
  if (frameWidth < 16) {
    return h(Box, { paddingLeft: 1, flexDirection: 'column' },
      h(Text, { color: T.accent, bold: true, wrap: 'truncate-end' }, `> ${APP_NAME}`),
      h(Text, { color: T.textMuted, wrap: 'truncate-end' }, model),
    );
  }
  const inner = frameWidth - 4;
  const pad = value => String(value).slice(0, inner).padEnd(inner, ' ');
  const location = String(cwd || '.');
  const cwdShort = location.length > inner - 5
    ? '...' + location.slice(-Math.max(0, inner - 8))
    : location;
  const top = '┌' + '─'.repeat(frameWidth - 2) + '┐';
  const bottom = '└' + '─'.repeat(frameWidth - 2) + '┘';
  const row = value => `│ ${pad(value)} │`;
  return h(Box, { flexDirection: 'column', paddingTop: 1, paddingLeft: 1 },
    h(Text, { color: T.border }, top),
    h(Text, { color: T.accent, bold: true }, row('> ' + APP_NAME)),
    h(Text, { color: T.textMuted }, row(uiText('model: ', 'modelo: ') + model + ' · ' + sessionLabel)),
    h(Text, { color: T.textMuted }, row('cwd: ' + cwdShort)),
    h(Text, { color: T.border }, bottom),
  );
}

function SpinnerLine({ label, started }) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const frames = T.spinFrames || SPIN_FRAMES;
  const ms = T.spinMs || SPIN_MS;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
      if (started) setElapsed(Date.now() - started);
    }, ms);
    return () => clearInterval(timer);
  }, [started, frames.length, ms]);

  const elapsedStr = elapsed > 1500 ? formatElapsed(elapsed) : '';

  return h(Box, { paddingLeft: 5, gap: 1 },
    h(Text, { color: T.accentSoft }, frames[frame]),
    h(Text, { color: T.textMuted }, label),
    elapsedStr ? h(Text, { color: T.textGhost }, elapsedStr) : null,
  );
}

function EventLine({ kind, title, detail, width }) {
  const cfg = {
    info: { sym: '·', color: T.textGhost },
    think: { sym: '◐', color: T.textGhost },
    comment: { sym: '›', color: T.accent },
    tool: { sym: '↳', color: T.purple },
    ok: { sym: '✓', color: T.green },
    warn: { sym: '▲', color: T.amber },
    error: { sym: '×', color: T.red },
  };
  const { sym, color } = cfg[kind] || cfg.info;
  const content = formatEventPreview({ kind, title, detail }, width);
  return h(Box, { paddingLeft: 2, paddingRight: 2, flexDirection: 'column' },
    h(Box, { gap: 1 },
      h(Text, { color, bold: true }, sym),
      h(Text, { color: kind === 'error' ? T.red : T.textDim, bold: true, wrap: 'truncate-end' }, String(title || '').trim()),
    ),
    content.lines.length
      ? h(Box, { paddingLeft: 2, flexDirection: 'column' },
          ...content.lines.map((line, i) => h(Text, { key: String(i), color: T.textMuted, wrap: 'truncate-end' }, line)),
          content.hint ? h(Text, { color: T.accentDim, wrap: 'truncate-end' }, content.hint) : null,
        )
      : null,
  );
}

function UserMessage({ text }) {
  const lines = String(text || '').split('\n');
  return h(Box, { paddingLeft: 3, paddingRight: 3, marginTop: 1, marginBottom: 0, flexDirection: 'row' },
    h(Box, { flexDirection: 'column' },
      h(Box, { gap: 1, marginBottom: 0 },
        h(Text, { color: T.accent, bold: true }, '>'),
        h(Text, { color: T.textDim, bold: true }, uiText('You', 'Tú')),
      ),
      h(Box, { paddingLeft: 2, flexDirection: 'column' },
        ...lines.map((line, i) => h(Text, { key: String(i), color: T.text, wrap: 'wrap' }, line)),
      ),
    ),
  );
}


function ThinkingBlock({ text, elapsed, live, width, expanded: initialExpanded }) {
  const [expanded, setExpanded] = useState(!!initialExpanded);
  const displayLines = React.useMemo(() => {
    const lines = text.split('\n').filter(l => l.trim());
    return { lines, more: 0 };
  }, [text, live]);
  const { lines, more } = displayLines;

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    setExpanded(!!initialExpanded);
  }, [initialExpanded]);

  const frames = T.spinFrames || SPIN_FRAMES;
  const ms = T.spinMs || SPIN_MS;
  const pulseChar = live ? frames[Math.floor(Date.now() / ms) % frames.length] : '\u25d0';

  const lineCount = lines.length;

  // Live thinking always shows normally (streaming)
  if (live) {
    return h(Box, { flexDirection: 'column', paddingLeft: 3, marginTop: 1 },
      h(Box, { gap: 1 },
        h(Text, { color: T.textGhost }, pulseChar),
        h(Text, { color: T.textGhost }, uiText('Thinking...', 'Pensando...')),
      ),
      lines.length > 0
        ? h(Box, { flexDirection: 'column', paddingLeft: 1 },
            ...lines.map((line, i) =>
              h(Text, { key: String(i), color: T.textMuted, wrap: 'wrap' }, line),
            ),
            more > 0 ? h(Text, { color: T.textGhost }, '\u00b7\u00b7\u00b7 ' + more + ' ' + uiText('more lines', 'líneas más')) : null,
          )
        : null,
    );
  }

  // Stored thinking: collapsed by default, toggle all via Ctrl+T
  return h(Box, { flexDirection: 'column', paddingLeft: 3, marginTop: 1 },
    h(Box, { gap: 1 },
      h(Text, { color: T.textGhost }, pulseChar),
      h(Text, { color: T.textGhost },
        expanded
          ? (uiText('Thought for ', 'Pensó durante ') + elapsed + 's')
          : (uiText('Thinking', 'Pensamiento') + ' \u2014 ' + lineCount + ' ' + uiText('lines', 'líneas'))
      ),
    ),
    expanded && lines.length > 0
      ? h(Box, { flexDirection: 'column', paddingLeft: 1 },
          ...lines.map((line, i) =>
            h(Text, { key: String(i), color: T.textMuted, wrap: 'wrap' }, line),
          ),
          more > 0 ? h(Text, { color: T.textGhost }, '\u00b7\u00b7\u00b7 ' + more + ' ' + uiText('more lines', 'líneas más')) : null,
        )
      : null,
  );
}

function AnswerBlock({ text, live, width }) {
  if (!text) return null;
  const content = React.useMemo(() => {
    const displayText = normalizeAssistantDisplayText(text);
    return { displayText };
  }, [text]);
  const contentWidth = Math.max(40, (width || 80) - 8);
  return h(Box, { flexDirection: 'column', paddingLeft: 3, paddingRight: 3, marginTop: 1 },
    h(Box, { gap: 1, marginBottom: 0 },
      h(Text, { color: T.accentSoft, bold: true }, '\u25c9'),
      h(Text, { color: T.textDim, bold: true }, APP_NAME),
    ),
    h(Box, { flexDirection: 'column', paddingLeft: 2 },
      h(MarkdownContent, { text: content.displayText, width: contentWidth, live }),
      live ? h(Text, { color: T.accent }, '\u258e') : null,
    ),
  );
}

function SystemMsg({ text }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 5 },
    ...text.split('\n').map((line, i) =>
      h(Text, { key: String(i), color: T.textMuted, wrap: 'wrap' }, line),
    ),
  );
}

function QueuedMessage({ text }) {
  return h(Box, { paddingLeft: 5, gap: 1, marginTop: 0 },
    h(Text, { color: T.amber }, '\u{1F4E9}'),
    h(Text, { color: T.textGhost, italic: true, wrap: 'wrap' }, text),
  );
}

function ConfirmBar({ request, width, height }) {
  const view = confirmationViewport(request, width, height, global.__zynCurrentLanguage || 'en');
  const maxWidth = Math.max(10, width - 5);
  return h(Box, {
    flexDirection: 'column', paddingLeft: 1, paddingRight: 1,
    marginTop: 0, borderStyle: 'round', borderColor: T.amber,
  },
    h(Box, { gap: 1 },
      h(Text, { color: T.amber, bold: true }, '◆'),
      h(Text, { color: T.text, bold: true, wrap: 'truncate-end' }, view.title.slice(0, maxWidth)),
    ),
    h(Box, { flexDirection: 'column', paddingLeft: 1 },
      ...view.lines.map((line, i) =>
        h(Text, { key: String(i), color: T.textDim, wrap: 'truncate-end' }, line),
      ),
      view.hidden > 0
        ? h(Text, { color: T.textGhost }, uiText(`… ${view.hidden} lines hidden`, `… ${view.hidden} líneas ocultas`))
        : null,
    ),
    h(Text, { color: T.textMuted, wrap: 'truncate-end' }, view.footer),
  );
}

function TranscriptPanel({ view, width, height }) {
  const page = transcriptViewport(view, width, height);
  const paneHeight = Math.max(2, height - 4);
  return h(Box, { flexDirection: 'column', height, paddingLeft: 2, paddingRight: 2 },
    h(Text, { color: T.accent, bold: true }, uiText('Transcript · recent activity', 'Transcripción · actividad reciente')),
    h(Text, { color: T.textGhost }, `${page.start + 1}-${page.end} / ${page.total}`),
    h(Box, { flexDirection: 'column', height: paneHeight, overflowY: 'hidden' },
      ...page.lines.map((line, index) => h(Text, {
        key: String(page.start + index), color: T.textDim, wrap: 'truncate-end',
      }, line || ' ')),
    ),
    h(Text, { color: T.accentDim, wrap: 'truncate-end' },
      width < 52
        ? uiText('↑↓ scroll · Esc close', '↑↓ mover · Esc cerrar')
        : uiText('↑↓ scroll · PgUp/PgDn · Esc close · /export for full file', '↑↓ mover · RePág/AvPág · Esc cerrar · /export para archivo completo')),
  );
}

function AuthCard({ width, flow }) {
  if (!flow) return null;
  const compact = width < 48;
  return h(Box, {
    flexDirection: 'column', paddingLeft: 1, paddingRight: 1,
    borderStyle: 'round', borderColor: T.accent,
  },
    h(Box, { gap: 1 },
      h(Text, { color: T.accent, bold: true }, '◇'),
      h(Text, { color: T.text, bold: true }, uiText('Connect ChatGPT', 'Conectar ChatGPT')),
    ),
    h(Text, { color: T.textMuted, wrap: 'truncate-end' }, uiText('Complete authorization in your browser.', 'Autoriza el acceso desde el navegador.')),
    h(Text, { color: T.textDim, wrap: 'truncate-end' }, compact
      ? uiText('C copy · O open · Esc cancel', 'C copiar · O abrir · Esc cancelar')
      : uiText('C copy URL · O open browser · L show URL · Esc cancel', 'C copiar URL · O abrir navegador · L ver URL · Esc cancelar')),
  );
}

function SelectBar({ request, width, height = 24 }) {
  if (!request) return null;
  const items = Array.isArray(request.items) ? request.items : [];
  const total = items.length;
  const w = width || 100;
  const compact = layoutForWidth(w).compact;
  const maxVisible = Math.max(1, Math.min(20, Math.floor(w / 5), height - 12));
  const safeIdx = Math.max(0, Math.min(request.selected || 0, total - 1));
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, safeIdx - half);
  const end = Math.min(total, start + maxVisible);
  start = Math.max(0, end - maxVisible);
  const visible = items.slice(start, end);

  return h(Box, {
    flexDirection: 'column',
    paddingLeft: 1,
    paddingRight: 1,
    marginTop: 1,
    borderStyle: 'round',
    borderColor: T.borderLight,
  },
    compact
      ? h(Box, { flexDirection: 'column', paddingLeft: 1 },
          h(Text, { color: T.accent, bold: true, wrap: 'truncate-end' }, '> ' + (request.title || 'Select')),
          request.subtitle
            ? h(Text, { color: T.textMuted, wrap: 'truncate-end' }, String(request.subtitle).slice(0, Math.max(1, w - 8)))
            : null,
        )
      : h(Box, { paddingLeft: 1 },
          h(Text, { color: T.amber, bold: true }, '> '),
          h(Text, { color: T.text, bold: true }, request.title || 'Select'),
          request.subtitle ? h(Text, { color: T.textMuted }, '  ' + request.subtitle) : null,
        ),
    h(Box, { flexDirection: 'column', paddingTop: 0 },
      ...visible.map((item, i) => {
        const realIdx = start + i;
        const isSelected = realIdx === safeIdx;
        const label = request.getLabel ? request.getLabel(item, realIdx) : String(request.getValue ? request.getValue(item) : item);
        const active = request.isActive && request.isActive(item);
        const prefix = isSelected ? '\u25b8 ' : '  ';
        const number = String(realIdx + 1).padStart(2, ' ');
        const color = isSelected ? T.accent : (active ? T.green : T.textMuted);
        const maxLabel = Math.max(1, w - (compact ? 12 : 9));
        const shortLabel = String(label).length > maxLabel ? String(label).slice(0, maxLabel - 1) + '…' : label;
        return h(Box, { key: realIdx, paddingLeft: compact ? 0 : 2 },
          h(Text, { color, bold: isSelected, wrap: 'truncate-end' }, `${prefix}${number} ${shortLabel}`),
        );
      }),
      total > maxVisible
        ? h(Box, { paddingLeft: 2, marginTop: 0, flexDirection: 'row', gap: 1 },
            h(Text, { color: T.textMuted }, `[${start + 1}-${end} / ${total}]`),
            h(Text, { color: T.textGhost }, '\u00b7'),
            h(Text, { color: T.textMuted }, '\u2191/\u2193'),
          )
        : null,
    ),
    compact
      ? h(Text, { color: T.textMuted, wrap: 'truncate-end' }, '  ↑/↓ · Enter · Esc')
      : h(Box, { paddingLeft: 1, gap: 2 },
          h(Text, { color: T.textMuted }, '↑/↓'),
          h(Text, { color: T.textGhost }, '·'),
          h(Text, { color: T.textMuted }, 'Enter'),
          h(Text, { color: T.textGhost }, '·'),
          h(Text, { color: T.textMuted }, 'Esc'),
        ),
  );
}

function StatusBar({ store, model, providerKey, processing, width, turnCount }) {
  const [frame, setFrame] = useState(0);
  const frames = T.spinFrames || SPIN_FRAMES;
  const ms = T.spinMs || SPIN_MS;

  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), ms);
    return () => clearInterval(t);
  }, [processing, frames.length, ms]);

  const layout = layoutForWidth(width);
  const active = getProviderBrand(providerKey);
  const line = '\u2500'.repeat(Math.max(1, Math.min(layout.columns - 4, 120)));
  const safeW = layout.statusWidth;
  const tokenEstimate = store.tokenEstimate || 0;
  const contextLimit = store.contextLimit || 0;

  function fmtK(n) {
    if (n < 1000) return `${n}`;
    if (n < 100000) return `${(n / 1000).toFixed(1)}K`;
    return `${(n / 1000).toFixed(0)}K`;
  }
  const measured = store.lastMeasuredTokens || 0;
  const currentTokens = measured || tokenEstimate;
  const tokenStr = currentTokens > 0 || contextLimit > 0
    ? `${measured ? '' : '~'}${fmtK(currentTokens)}/${contextLimit > 0 ? fmtK(contextLimit) : '?'}`
    : '';
  const exactTokens = measured ? `measured:${fmtK(measured)}` : '';
  const tokenColor = contextLimit > 0 && tokenEstimate > contextLimit * 0.85
    ? T.amber
    : T.textInvis;

  if (layout.compact || width < 78) {
    const shortModel = String(model).slice(0, Math.max(1, layout.columns - 17));
    return h(Box, { flexDirection: 'column', paddingLeft: 1, paddingRight: 1 },
      h(Text, { color: T.border }, line),
      h(Text, { color: T.textMuted, wrap: 'truncate-end' },
        `> ${shortModel}${processing ? ' ...' : ''}${tokenStr ? ` · ${tokenStr}` : ''} · /help${width >= 48 ? ' · ' + uiText('esc exit', 'esc salir') : ''}`),
    );
  }

  return h(Box, { flexDirection: 'column', paddingLeft: 1, paddingRight: 1 },
    h(Box, {},
      h(Text, { color: T.border }, line),
    ),
    h(Box, { paddingLeft: 1, paddingTop: 0, gap: 1, justifyContent: 'space-between', width: safeW },
      h(Box, { gap: 1 },
        h(Text, { color: T.accent }, '>'),
        h(Text, { color: active.color }, `[${active.mark}]`),
        h(Text, { color: T.textGhost }, model),
        processing
          ? h(Text, { color: T.accentSoft }, frames[frame])
          : null,
        turnCount > 0
          ? h(Text, { color: T.textInvis }, '\u00b7 ' + turnCount + ' ' + uiText(turnCount === 1 ? 'turn' : 'turns', turnCount === 1 ? 'turno' : 'turnos'))
          : null,
      ),
      h(Box, { gap: 1 },
        tokenStr
          ? h(Text, { color: tokenColor }, tokenStr)
          : null,
        exactTokens && width >= 95 ? h(Text, { color: T.cyan }, exactTokens) : null,
        h(Text, { color: T.textInvis }, '/help'),
        h(Text, { color: T.textInvis }, '\u00b7'),
        h(Text, { color: T.textInvis }, uiText('esc exit', 'esc salir')),
      ),
    ),
  );
}

function PromptBar({ request, width }) {
  if (!request) return null;
  const hidden = Boolean(request.hidden);
  const displayValue = hidden && request.value
    ? '*'.repeat(request.value.length)
    : (request.value || '');

  return h(Box, {
    flexDirection: 'column',
    paddingLeft: 2,
    paddingRight: 2,
    marginTop: 1,
    borderStyle: 'round',
    borderColor: T.borderLight,
  },
    h(Box, { paddingTop: 0, paddingBottom: 0 },
      h(Text, { color: T.amber, bold: true }, '> '),
      h(Text, { color: T.text, bold: true }, request.title || 'Input'),
      request.subtitle
        ? h(Text, { color: T.textGhost }, '  ' + request.subtitle)
        : null,
    ),
    h(Box, { paddingTop: 0, paddingBottom: 0 },
      h(Text, { color: T.textGhost }, (request.prompt || '>') + ' '),
      h(Text, { color: T.textMuted }, displayValue.slice(0, -1) || ''),
      h(Text, { color: T.text, inverse: true }, displayValue.length > 0 ? displayValue.slice(-1) : ' '),
    ),
    h(Box, { paddingTop: 0, paddingBottom: 0, gap: 1 },
      h(Text, { color: T.textGhost }, uiText('Type to enter', 'Escribe para ingresar')),
      h(Text, { color: T.textInvis }, '\u00b7'),
      h(Text, { color: T.textGhost }, 'Enter ' + uiText('confirm', 'confirmar')),
      h(Text, { color: T.textInvis }, '\u00b7'),
      h(Text, { color: T.textGhost }, 'Esc ' + uiText('cancel', 'cancelar')),
    ),
  );
}

function StaticItem({ item, width }) {
  switch (item.type) {
    case 'banner':   return h(Banner,        { model: item.model, resumed: item.resumed, width, cwd: item.cwd });
    case 'divider':  return h(Box, { paddingLeft: 2 }, h(Text, { color: T.textInvis }, ' '));
    case 'user':     return h(UserMessage,   { text: item.text });
    case 'thinking': return h(ThinkingBlock, { text: item.text, elapsed: item.elapsed, width, expanded: item.expanded });
    case 'answer':   return h(AnswerBlock,   { text: item.text, width });
    case 'event':    return h(EventLine,     { kind: item.kind, title: item.title, detail: item.detail, width });
    case 'system':   return h(SystemMsg,     { text: item.text });
    case 'queued':   return h(QueuedMessage, { text: item.text });
    default:         return null;
  }
}


function clampCursor(nextCursor, length) {
  return Math.max(0, Math.min(nextCursor, length));
}

function isBackspaceInput(input, key) {
  return Boolean(key?.backspace || key?.delete || input === '\b' || input === '\x7f' || input === '\u0008');
}

function InputBar({ onSubmit, processing, width = 100, height = 24, draft = '', onDraftChange }) {
  const [value, setValue] = useState(draft || '');
  const [cursor, setCursor] = useState((draft || '').length);
  const [histIdx, setHistIdx] = useState(-1);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const historyRef = useRef([]);
  const savedRef = useRef('');
  const lastPasteMetaRef = useRef(null);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const histIdxRef = useRef(histIdx);
  const suggestIdxRef = useRef(suggestIdx);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    histIdxRef.current = histIdx;
  }, [histIdx]);

  useEffect(() => {
    suggestIdxRef.current = suggestIdx;
  }, [suggestIdx]);

  useEffect(() => {
    if (draft !== valueRef.current) {
      const nextValue = String(draft || '');
      valueRef.current = nextValue;
      cursorRef.current = nextValue.length;
      setValue(nextValue);
      setCursor(nextValue.length);
      setHistIdx(-1);
      histIdxRef.current = -1;
      setSuggestIdx(0);
      suggestIdxRef.current = 0;
    }
  }, [draft]);

  const commitValue = useCallback((nextValue, nextCursor = nextValue.length) => {
    const safeValue = String(nextValue || '');
    const safeCursor = clampCursor(nextCursor, safeValue.length);
    valueRef.current = safeValue;
    cursorRef.current = safeCursor;
    setValue(safeValue);
    setCursor(safeCursor);
    if (onDraftChange) onDraftChange(safeValue);
  }, [onDraftChange]);

  const showSuggestions = value.startsWith('/') && !value.includes(' ') && value.length > 0;
  const localSlash = [];
  const suggestions = showSuggestions
    ? [...SLASH_COMMANDS, ...localSlash].filter(c => ('/' + c.name).startsWith(value.toLowerCase()))
    : [];

  useInput((input, key) => {
    if (/(?:\x1b)?\[<\d+;\d+;\d+[Mm]/.test(input)) return;
    const currentValue = valueRef.current;
    const currentCursor = cursorRef.current;
    const currentShowSuggestions = currentValue.startsWith('/') && !currentValue.includes(' ') && currentValue.length > 0;
    const currentSuggestions = currentShowSuggestions
      ? [...SLASH_COMMANDS, ...localSlash].filter(c => ('/' + c.name).startsWith(currentValue.toLowerCase()))
      : [];

    const event = normalizeInputEvent(input, key);
    const batch = !key.ctrl && !key.meta ? splitSubmittedInput(input, key) : null;
    if (batch) {
      const first = currentValue.slice(0, currentCursor) + batch.complete[0] + currentValue.slice(currentCursor);
      const messages = [first, ...batch.complete.slice(1)];
      for (const message of messages) {
        const text = message.trim();
        if (!text) continue;
        historyRef.current.unshift(text);
        if (historyRef.current.length > 100) historyRef.current.pop();
        onSubmit(text, { kind: 'paste', length: text.length, multiline: true });
      }
      commitValue(batch.rest, batch.rest.length);
      setHistIdx(-1);
      histIdxRef.current = -1;
      setSuggestIdx(0);
      suggestIdxRef.current = 0;
      return;
    }

    const backspace = key?.backspace || input === '\b' || input === '\x7f' || input === '\u0008';
    if (backspace || key?.delete) {
      const edit = editDelete(currentValue, currentCursor, backspace ? 'backward' : 'forward');
      if (edit.value !== currentValue) {
        commitValue(edit.value, edit.cursor);
        setSuggestIdx(0);
        suggestIdxRef.current = 0;
      }
      return;
    }

    if (event.submit) {
      const updated = currentValue.slice(0, currentCursor) + event.text + currentValue.slice(currentCursor);
      let text = updated.trim();
      if (!text) {
        if (event.text) commitValue(updated, currentCursor + event.text.length);
        return;
      }
      if (currentShowSuggestions && currentSuggestions.length > 0 && text === '/') {
        const cmd = currentSuggestions[suggestIdxRef.current] || currentSuggestions[0];
        if (cmd) text = `/${cmd.name}`;
      }
      historyRef.current.unshift(text);
      if (historyRef.current.length > 100) historyRef.current.pop();
      commitValue('', 0);
      setHistIdx(-1);
      histIdxRef.current = -1;
      setSuggestIdx(0);
      suggestIdxRef.current = 0;
      onSubmit(text, event.paste ? { kind: 'paste', length: event.text.length, multiline: /\n/.test(input) } : lastPasteMetaRef.current);
      lastPasteMetaRef.current = null;
      return;
    }

    if (key.tab && currentSuggestions.length > 0) {
      const cmd = currentSuggestions[suggestIdxRef.current] || currentSuggestions[0];
      if (cmd) {
        const completed = `/${cmd.name} `;
        commitValue(completed, completed.length);
        setSuggestIdx(0);
        suggestIdxRef.current = 0;
      }
      return;
    }

    if (currentShowSuggestions && currentSuggestions.length > 0) {
      if (key.upArrow) {
        const next = Math.max(0, suggestIdxRef.current - 1);
        setSuggestIdx(next);
        suggestIdxRef.current = next;
        return;
      }
      if (key.downArrow) {
        const next = Math.min(currentSuggestions.length - 1, suggestIdxRef.current + 1);
        setSuggestIdx(next);
        suggestIdxRef.current = next;
        return;
      }
    }

    if (key.upArrow) {
      const hist = historyRef.current;
      if (hist.length === 0) return;
      if (histIdxRef.current === -1) savedRef.current = currentValue;
      const next = Math.min(histIdxRef.current + 1, hist.length - 1);
      setHistIdx(next);
      histIdxRef.current = next;
      commitValue(hist[next], hist[next].length);
      return;
    }

    if (key.downArrow) {
      if (histIdxRef.current <= 0) {
        setHistIdx(-1);
        histIdxRef.current = -1;
        commitValue(savedRef.current, savedRef.current.length);
        return;
      }
      const next = histIdxRef.current - 1;
      setHistIdx(next);
      histIdxRef.current = next;
      commitValue(historyRef.current[next], historyRef.current[next].length);
      return;
    }

    if (key.leftArrow) {
      const nextCursor = moveCursor(currentValue, currentCursor, -1);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
      return;
    }

    if (key.rightArrow) {
      const nextCursor = moveCursor(currentValue, currentCursor, 1);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
      return;
    }

    if (key.ctrl && input === 'a') {
      cursorRef.current = 0;
      setCursor(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      const nextCursor = currentValue.length;
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
      return;
    }

    if (key.ctrl && input === 'u') {
      const after = currentValue.slice(currentCursor);
      commitValue(after, 0);
      return;
    }

    if (key.ctrl && input === 'z') {
      onSubmit('/undo');
      return;
    }

    if (key.ctrl && input === 'y') {
      onSubmit('/redo');
      return;
    }

    if (key.ctrl && input === 'w') {
      const before = currentValue.slice(0, currentCursor);
      const after = currentValue.slice(currentCursor);
      const trimmed = before.replace(/\S+\s*$/, '');
      commitValue(trimmed + after, trimmed.length);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const safeInput = event.text;
      if (!safeInput) return;
      lastPasteMetaRef.current = event.paste
        ? { kind: 'paste', length: safeInput.length, multiline: /[\r\n]/.test(input) }
        : null;
      const nextValue = currentValue.slice(0, currentCursor) + safeInput + currentValue.slice(currentCursor);
      const nextCursor = currentCursor + safeInput.length;
      commitValue(nextValue, nextCursor);
      setSuggestIdx(0);
      suggestIdxRef.current = 0;
    }
  });

  const hasText = value.length > 0;
  const layout = layoutForWidth(width);
  const maxInputCols = layout.inputColumns;
  let start = Math.max(0, cursor - Math.floor(maxInputCols * 0.7));
  if (value.length - start < maxInputCols) {
    start = Math.max(0, value.length - maxInputCols);
  }
  const visibleText = value.slice(start, start + maxInputCols);
  const cursorInVisible = Math.max(0, Math.min(cursor - start, visibleText.length));
  const before = visibleText.slice(0, cursorInVisible);
  const cursorChar = visibleText[cursorInVisible] || ' ';
  const after = visibleText.slice(cursorInVisible + 1);

  const promptColor = processing ? T.amber : T.accent;
  const placeholder = processing ? uiText(' Queued — type and it will run later...', ' En cola — escribe y se procesará después...') : uiText(' Type a message...', ' Escribe un mensaje...');

  const inputLine = h(Box, { paddingLeft: layout.inputPadding, paddingRight: layout.inputPadding, paddingTop: 0, paddingBottom: 0, marginTop: 1 },
    h(Text, { color: promptColor }, processing ? '\u{1F4E9} ' : '\u276f '),
    hasText
      ? h(Box, {},
          h(Text, { color: T.text }, before),
          h(Text, { color: promptColor, inverse: true }, cursorChar),
          after ? h(Text, { color: T.text }, after) : null,
        )
      : h(Box, {},
          h(Text, { color: promptColor, inverse: true }, ' '),
          h(Text, { color: T.textGhost, wrap: 'truncate-end' }, placeholder.slice(0, Math.max(0, maxInputCols - 1))),
        ),
  );

  if (suggestions.length === 0) return inputLine;

  const maxVisible = Math.max(1, Math.min(8, height - 8));
  const safeIdx = Math.min(suggestIdx, suggestions.length - 1);
  const windowStart = Math.max(0, Math.min(safeIdx - maxVisible + 1, suggestions.length - maxVisible));
  const visible = suggestions.slice(windowStart, windowStart + maxVisible);
  const hasMore = suggestions.length > maxVisible;

  return h(Box, { flexDirection: 'column' },
    inputLine,
    h(Box, { flexDirection: 'column', paddingLeft: layout.compact ? 2 : 5, marginTop: 0 },
      hasMore && windowStart > 0
        ? h(Text, { color: T.textInvis }, '  \u2191 ' + uiText('more', 'más'))
        : null,
      ...visible.map((cmd, i) => {
        const realIdx = windowStart + i;
        const selected = realIdx === safeIdx;
        return h(Box, { key: cmd.name },
          h(Text, {
            color: selected ? T.accent : T.textMuted,
            bold: selected,
          }, selected ? '\u25b8 ' : '  '),
          h(Text, {
            color: selected ? T.accent : T.textMuted,
          }, `/${cmd.name}`),
          !layout.compact ? h(Text, { color: T.textGhost, wrap: 'truncate-end' }, `  ${getTuiLang() === 'es' ? (cmd.descEs || cmd.desc) : cmd.desc}`) : null,
        );
      }),
      hasMore && windowStart + maxVisible < suggestions.length
        ? h(Text, { color: T.textInvis }, '  \u2193 ' + uiText('more', 'más'))
        : null,
      h(Box, { paddingTop: 0 },
        h(Text, { color: T.textInvis }, uiText('Tab complete · ↑↓ navigate', 'Tab completar · ↑↓ navegar')),
      ),
    ),
  );
}

export function App({ store, state, onSubmit }) {
  useStore(store);
  global.__zynCurrentLanguage = state?.language || 'en';
  const { exit } = useApp();
  const { width, height } = useDimensions();
  const themeVersion = store.themeVersion;

  useEffect(() => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
    const onMouse = chunk => {
      const steps = mouseWheelSteps(chunk);
      if (steps) {
        if (store.transcriptView) store.scrollTranscript(steps * 3, width, height - 3);
        else store.scrollBy(steps * 3);
      }
    };
    process.stdin.on('data', onMouse);
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    return () => {
      process.stdin.off('data', onMouse);
      process.stdout.write('\x1b[?1000l\x1b[?1006l');
    };
  }, [store, width, height]);

  const modelKey   = state?.activeModel || DEFAULT_MODEL_KEY;
  const modelLabel = modelDisplayId(modelKey, MODELS[modelKey]);

  const handleInput = useCallback((text, meta) => {
    if (text === '/exit' || text === '/quit') {
      if (store.processing) {
        store.pendingExit = true;
        store.addEvent('info', uiText('exiting after current turn', 'saliendo al terminar el turno actual'));
        return;
      }
      exit();
      return;
    }
    onSubmit(text, meta);
  }, [onSubmit, exit, store]);

  useInput((input, key) => {
    if (/(?:\x1b)?\[<\d+;\d+;\d+[Mm]/.test(input)) return;
    if (key.ctrl && input === 'c') {
      if (store.authFlow) { store.authFlow.cancel(); store.setAuthFlow(null); }
      try {
        const { saveState } = require('../utils/sessionStorage');
        if (typeof saveState === 'function') saveState(state);
      } catch {}
      exit();
      return;
    }
    if (store.transcriptView) {
      if (key.escape || input === 'q') { store.closeTranscript(); return; }
      const rows = Math.max(2, height - 7);
      if (key.upArrow || input === 'k') store.scrollTranscript(1, width, height - 3);
      else if (key.downArrow || input === 'j') store.scrollTranscript(-1, width, height - 3);
      else if (key.pageUp) store.scrollTranscript(rows, width, height - 3);
      else if (key.pageDown) store.scrollTranscript(-rows, width, height - 3);
      else if (key.home) store.scrollTranscript(1000000, width, height - 3);
      else if (key.end) store.scrollTranscript(-1000000, width, height - 3);
      return;
    }
    if (key.ctrl && input === 't') {
      state.settings = state.settings || {};
      const newVal = !state.settings.showThinking;
      state.settings.showThinking = newVal ? 1 : 0;
      if (!newVal) delete state.settings.showThinking;
      store.setShowThinking(newVal);
      try {
        const { saveState } = require('../utils/sessionStorage');
        saveState(state);
      } catch {}
      return;
    }
    if (key.escape) {
      if (store.authFlow) {
        store.authFlow.cancel();
        store.setAuthFlow(null);
        return;
      }
      if (store.selectRequest) {
        store.cancelSelect();
        return;
      }
      if (store.inputRequest) {
        const val = store.inputRequest?.value || '';
        if (val.trim()) {
          store.inputDraft = val;
        }
        store.cancelInput();
        return;
      }
      if (store.processing) {
        const now = Date.now();
        if (store.lastEscapeAt !== -1 && now - store.lastEscapeAt < 500) {
          store.lastEscapeAt = 0;
          if (typeof state.abortCurrentTurn === 'function') {
            state.abortCurrentTurn();
          }
          store.addEvent('warn', uiText('stop requested', 'interrupción solicitada'), uiText('Waiting for the current turn to stop', 'Esperando a que termine la ejecución'));
          return;
        }
        store.lastEscapeAt = now;
        store.addEvent('info', uiText('press ESC again', 'pulsa ESC otra vez'), uiText('to stop', 'para detener'));
        return;
      }
      const now = Date.now();
      if (store.lastEscapeAt !== -1 && now - store.lastEscapeAt < 500) {
        store.lastEscapeAt = 0;
        exit();
        return;
      }
      store.lastEscapeAt = now;
      store.addEvent('info', uiText('press ESC again', 'pulsa ESC otra vez'), uiText('to exit', 'para salir'));
      return;
    }
    if (store.authFlow) {
      const keyValue = String(input || '').toLowerCase();
      if (keyValue === 'c') {
        const result = require('../core/clipboard').copyToClipboard(store.authFlow.url, { output: process.stdout });
        store.addEvent(result.verified ? 'ok' : 'info',
          result.verified ? uiText('Login link copied', 'Enlace de acceso copiado') : uiText('Copy requested', 'Copia solicitada'),
          result.verified ? '' : uiText('Terminal clipboard support varies (OSC52).', 'El soporte del portapapeles depende del terminal (OSC52).'));
        return;
      }
      if (keyValue === 'o') {
        require('../auth/browser').openChatGPTAuthBrowser(store.authFlow.url);
        store.addEvent('info', uiText('Opening browser', 'Abriendo navegador'), '');
        return;
      }
      if (keyValue === 'l') {
        store.addItem({ type: 'system', text: store.authFlow.url });
        return;
      }
      return;
    }
    if (store.selectRequest) {
      const quickNumber = String(input || '').match(/^([1-9])(?:\r|\n)?$/);
      if (quickNumber) {
        const index = Number(quickNumber[1]) - 1;
        const selection = store.selectRequest;
        if (index < selection.items.length) {
          const item = selection.items[index];
          const value = selection.getValue ? selection.getValue(item, index) : item;
          store.resolveSelect(value);
          return;
        }
      }
      if (key.upArrow || input === '\x1b[A' || input === '\x1bOA' || input === '\x1b[[A') { store.adjustSelect(-1); return; }
      if (key.downArrow || input === '\x1b[B' || input === '\x1bOB' || input === '\x1b[[B') { store.adjustSelect(1); return; }
      if (key.return || input === '\r' || input === '\n') {
        const sel = store.selectRequest;
        const item = sel.items[sel.selected];
        const value = sel.getValue ? sel.getValue(item, sel.selected) : item;
        store.resolveSelect(value);
        return;
      }
      if (key.leftArrow || input === '\x1b[D' || input === '\x1bOD' || input === '\x1b[[D') { store.adjustSelect(-1); return; }
      if (key.rightArrow || input === '\x1b[C' || input === '\x1bOC' || input === '\x1b[[C') { store.adjustSelect(1); return; }
      if (input === 'k') { store.adjustSelect(-1); return; }
      if (input === 'j') { store.adjustSelect(1); return; }
      if (/^[1-9]$/.test(input)) {
        const num = Number(input);
        if (num >= 1 && num <= store.selectRequest.items.length) {
          const sel = store.selectRequest;
          const item = sel.items[num - 1];
          const value = sel.getValue ? sel.getValue(item, num - 1) : item;
          store.resolveSelect(value);
          return;
        }
      }
      if (input === 'q' || input === 'Q' || input === '\x1b') { store.cancelSelect(); return; }
      return;
    }
    if (store.inputRequest) {
      if (key.return || input === '\r' || input === '\n') {
        store.appendInputChar('\r');
        return;
      }
      if (key.backspace || key.delete || input === '\x7f' || input === '\b') {
        store.appendInputChar('\x7f');
        return;
      }
      if (input && input.length > 0) {
        store.appendInputChar(input);
        return;
      }
      return;
    }
    if (!store.confirmRequest) {
      const visible = selectViewportItems(store.items, {
        columns: width,
        rows: Math.max(1, height - 8),
        offset: store.scrollOffset,
      });
      const page = Math.max(1, visible.length - 1);
      if (key.pageUp || (key.ctrl && key.upArrow)) { store.scrollBy(page); return; }
      if (key.pageDown || (key.ctrl && key.downArrow)) { store.scrollBy(-page); return; }
      if (key.ctrl && key.home) { store.scrollBy(Infinity); return; }
      if (key.ctrl && key.end) { store.scrollToBottom(); return; }
      return;
    }
    if (input.toLowerCase() === 'v') { store.toggleConfirmDetails(); return; }
    if (key.upArrow || input === '\x1b[A') { store.scrollConfirmDetails(-1); return; }
    if (key.downArrow || input === '\x1b[B') { store.scrollConfirmDetails(1); return; }
    const decision = String(input || '').trim().toLowerCase();
    if (decision === 'y' || decision === 's' || decision === '1') store.resolveConfirm(true);
    else if (decision === 'n' || decision === '2' || key.return || input === '\r' || input === '\n') store.resolveConfirm(false);
  });

  if (store.transcriptView) {
    return h(Box, { flexDirection: 'column', height: '100%', width: '100%' },
      h(TranscriptPanel, { view: store.transcriptView, width, height: Math.max(7, height - 3) }),
      h(StatusBar, { store, model: modelLabel, providerKey: MODELS[state.activeModel]?.provider || 'unknown', processing: false, width, turnCount: store.turnCount }),
    );
  }

  const showInput   = !store.confirmRequest && !store.selectRequest && !store.inputRequest && !store.authFlow;
  const showConfirm = !!store.confirmRequest;
  const showSelect  = !!store.selectRequest;
  const showPrompt  = !!store.inputRequest;
  const showAuth = !!store.authFlow;

  const streamingArea = [];
  const controlArea = [];

  if (store.spinner && !store.liveThinking) {
    streamingArea.push(
      h(SpinnerLine, { key: 'spinner', label: store.spinner.label, started: store.spinner.started })
    );
  }

  if (store.liveThinking) {
    streamingArea.push(
      h(ThinkingBlock, { key: 'thinking', text: store.liveThinking.text, live: true, width })
    );
  }

  if (store.liveAnswer) {
    const liveText = normalizeAssistantDisplayText(store.liveAnswer.text);
    if (liveText) {
      streamingArea.push(
        h(AnswerBlock, { key: 'answer', text: liveText, live: true, width })
      );
    }
  }

  if (showAuth) {
    controlArea.push(h(AuthCard, { key: 'auth', width, flow: store.authFlow }));
  }

  if (showConfirm) {
    controlArea.push(
      h(ConfirmBar, { key: 'confirm', request: store.confirmRequest, width, height })
    );
  }

  if (showSelect) {
    controlArea.push(
      h(SelectBar, { key: 'select', request: store.selectRequest, width, height })
    );
  }

  if (showPrompt) {
    controlArea.push(
      h(PromptBar, { key: 'prompt', request: store.inputRequest, width })
    );
  }

  if (showInput) {
    controlArea.push(
      h(InputBar, { key: 'input', onSubmit: handleInput, processing: store.processing, width, height, draft: store.inputDraft, onDraftChange: (text) => store.setInputDraft(text) })
    );
  }

  const streamingRows = store.liveAnswer || store.liveThinking
    ? Math.max(2, Math.floor((height - 6) / 2))
    : store.spinner ? 2 : 0;
  const modalRows = showSelect
    ? Math.max(7, Math.min(20, Math.floor(width / 5), height - 12) + 5)
    : showPrompt ? 6 : showConfirm ? Math.min(height - 4, store.confirmRequest?.expanded ? 12 : 8) : showAuth ? 5 : 0;
  const inputRows = showInput ? (store.inputDraft.startsWith('/') ? Math.min(10, Math.max(2, height - 5)) : 2) : modalRows;
  const historyRows = Math.max(1, height - inputRows - streamingRows - 4);
  const historyWindow = selectViewportItems(store.items, { columns: width, rows: historyRows - (store.scrollOffset > 0 ? 1 : 0), offset: store.scrollOffset });

  return h(Box, { flexDirection: 'column', width: '100%', height: '100%' },
    h(Box, { flexDirection: 'column', height: historyRows, overflowY: 'hidden', flexShrink: 1, justifyContent: 'flex-start' },
      store.scrollOffset > 0
        ? h(Text, { color: T.textGhost, wrap: 'truncate-end' }, `  ${uiText('Older messages', 'Mensajes anteriores')} · PgDn ${uiText('to return', 'para volver')}`)
        : null,
      historyWindow.map(item =>
        h(Box, { key: item.id, flexDirection: 'column' },
          h(StaticItem, { item, width }),
        ),
      ),
    ),
    streamingRows > 0 ? h(Box, { flexDirection: 'column', height: streamingRows, overflowY: 'hidden', flexShrink: 1 }, ...streamingArea) : null,
    ...controlArea,
    h(StatusBar, {
      store,
      model: modelLabel,
      providerKey: MODELS[state.activeModel]?.provider || 'unknown',
      processing: store.processing && !showSelect && !showConfirm && !showPrompt && !showAuth,
      width,
      turnCount: store.turnCount,
    }),
  );
}

function getUiBindings(store, state) {
  const { countTokens, estimateContextTokens, getContextLimit } = require('../config');
  return {
    beginThinkingStream:    () => store.beginThinking(),
    writeThinkingDelta:     (_st, delta) => store.appendThinking(delta),
    endThinkingStream:      () => store.endThinking(),
    beginAssistantStream:   () => store.beginAnswer(),
    writeAssistantDelta:    (_st, delta) => store.appendAnswer(delta),
    endAssistantStream:     () => store.endAnswer(),
    logEvent: (st, kind, title, detail) => {
      pushAction(st, kind, title, detail);
      store.addEvent(kind, title, detail || '');
    },
    updateLastEventTitle: (title) => {
      store.updateLastEventTitle(title);
    },
    startThinkingIndicator: (st, label) => {
      pushAction(st, 'think', label);
      store.setSpinner(label);
      return () => store.setSpinner(null);
    },
    pushAction: (st, kind, title, detail) => pushAction(st, kind, title, detail),
    paint: (text) => text,
    syncTokenEstimate: () => {
      const estimate = estimateContextTokens(state);
      const limit = getContextLimit(state.activeModel);
      store.setTokenEstimate(estimate, limit);
    },
    setTokenUsage: (usage) => { state.lastTokenUsage = usage; store.setTokenUsage(usage); },
  };
}

export async function startTUI(options = {}) {
  const { state, resumed, rehydrated } = await loadOrCreateSessionState(null, options);
  T = getTheme(state.theme || 'dark');
  const store = new UIStore(uiText);
  store.currentModelKey = state.activeModel;
  store.setTokenEstimate(estimateContextTokens(state), getContextLimit(state.activeModel));
  if (state.lastTokenUsage) store.setTokenUsage(state.lastTokenUsage);
  globalStore = store;
  store.setShowThinking(state.settings?.showThinking);

  const saveStateSafe = () => {
    try {
      const { saveState } = require('../utils/sessionStorage');
      if (typeof saveState === 'function') {
        const result = saveState(state);
        if (result && typeof result.then === 'function') {
          const { writeFileSync, mkdirSync } = require('fs');
          const { dirname } = require('path');
          const sessionPath = state.sessionPath;
          if (sessionPath) {
            try {
              mkdirSync(dirname(sessionPath), { recursive: true });
              writeFileSync(sessionPath, JSON.stringify({
                sessionId: state.sessionId,
                sessionPath: state.sessionPath,
                createdAt: state.createdAt,
                updatedAt: new Date().toISOString(),
                title: state.title,
                cwd: state.cwd,
                history: state.history || [],
                memorySummary: state.memorySummary || '',
                importedMemory: state.importedMemory || '',
                sessionMemory: state.sessionMemory || {},
                actionLog: state.actionLog || [],
                turnCount: state.turnCount || 0,
                transcriptPath: state.transcriptPath,
                autoApprove: state.autoApprove,
                activeModel: state.activeModel,
                language: state.language,
                personaPrompt: state.personaPrompt || '',
                theme: state.theme || '',
                settings: state.settings || {},
              }, null, 2), 'utf8');
            } catch {}
          }
        }
      }
    } catch {}
  };
  const mcpCleanup = () => {
    try { require('../core/subagents').closeCoordinators(); } catch {}
    try { require('../mcp/client').stopAllStdioServers(); } catch {}
  };
  process.on('SIGINT', () => { mcpCleanup(); saveStateSafe(); process.exit(0); });
  process.on('SIGTERM', () => { mcpCleanup(); saveStateSafe(); process.exit(0); });
  process.on('exit', () => { mcpCleanup(); saveStateSafe(); });

  state.rl = null;
  state.tuiConfirm = (title, detail) => store.requestConfirm(title, detail || '');
  state.tuiSelect = (options) => store.requestSelect(options);
  state.tuiInput = (options) => store.requestInput(options);
  state.tuiAskUser = (question, allItems, customLabel) => store.requestAskUser(question, allItems, customLabel);

  try {
    const fs = require('fs');
    const { MCP_CONFIG_FILE } = require('../config');
    const mcpConfigPath = MCP_CONFIG_FILE;
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    state.mcpServers = mcpConfig.servers || {};
  } catch {
    state.mcpServers = {};
  }

  // Auto-connect MCP servers on startup
  try {
    const { autoConnectAll } = require('../mcp/client');
    const mcpResults = await autoConnectAll();
    const connected = mcpResults.filter(r => r.ok);
    const failed = mcpResults.filter(r => !r.ok);
    if (connected.length > 0) {
      const summary = connected.map(r => `${r.name}(${r.toolCount})`).join(', ');
      store.addEvent('info', 'MCP', uiText(`Connected: ${summary}`, `Conectados: ${summary}`));
    }
    if (failed.length > 0) {
      const failSummary = failed.map(r => `${r.name}: ${r.error || 'unreachable'}`).join(', ');
      store.addEvent('warn', 'MCP', uiText(`Failed: ${failSummary}`, `Fallidos: ${failSummary}`));
    }
  } catch {}

  try {
    const { loadPlugins } = require('../plugins/index');
    const pluginResult = loadPlugins();
    if (pluginResult.loaded > 0) {
      store.addEvent('info', 'Plugins', uiText(`${pluginResult.loaded} loaded, ${pluginResult.tools} tools`, `${pluginResult.loaded} cargados, ${pluginResult.tools} herramientas`));
    }
  } catch {}

  state.getQueuedMessages = () => {
    const msgs = store.messageQueue.filter(msg => !msg.startsWith('/'));
    store.messageQueue = store.messageQueue.filter(msg => msg.startsWith('/'));
    if (msgs.length) store._emit();
    return msgs;
  };
  state.clearQueuedMessages = () => {
    if (store.messageQueue.length) {
      store.messageQueue = [];
      store._emit();
    }
  };

  const modelKey   = state.activeModel || DEFAULT_MODEL_KEY;
  const modelLabel = modelDisplayId(modelKey, MODELS[modelKey]);
  const cwd = state.cwd || process.cwd();

  store.addItem({ type: 'banner', model: modelLabel, resumed, cwd });

  const completedBackgrounds = await listBackgroundResults(state.sessionId).catch(() => []);
  if (completedBackgrounds.length > 0) {
    for (const bg of completedBackgrounds) {
      const status = bg.result?.ok ? 'OK' : 'FAIL';
      const preview = bg.result?.ok
        ? String(bg.result.content || '').slice(0, 240)
        : (bg.result?.error || 'unknown');
      store.addItem({ type: 'system', text: `[background ${status}] task ${bg.taskId}\n${preview}` });
      await consumeBackgroundResult(bg.taskId);
    }
    store.addItem({ type: 'divider' });
  }

  if (rehydrated && Array.isArray(state.__resumedHistory) && state.__resumedHistory.length > 0) {
    const sessionTag = state.sessionId ? ` ${state.sessionId.slice(0, 8)}` : '';
    store.addItem({ type: 'system', text: uiText(`Resuming session${sessionTag} · ${state.__resumedHistory.length} messages`, `Reanudando sesion${sessionTag} · ${state.__resumedHistory.length} mensajes`) });
    for (const msg of state.__resumedHistory) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.role === 'user' && msg.content) {
        store.addItem({ type: 'user', text: String(msg.content) });
      } else if (msg.role === 'assistant' && msg.content) {
        const text = String(msg.content).trim();
        if (text) store.addItem({ type: 'answer', text });
      } else if (msg.role === 'tool') {
        store.addEvent('info', msg.tool || 'tool', String(msg.result || '').slice(0, 200));
      } else if (msg.role === 'system' && msg.content) {
        store.addItem({ type: 'system', text: String(msg.content) });
      }
    }
    store.addItem({ type: 'divider' });
  }

  async function handleSessionsCommand(store, state, input) {
    const { listSessions, loadSessionState } = require('../utils/sessionStorage');
    const sessions = await listSessions();
    if (!sessions || sessions.length === 0) {
      store.addEvent('info', uiText('no sessions', 'sin sesiones'), '');
      return;
    }
    const selected = await store.requestSelect({
      title: uiText('Select session', 'Seleccionar sesión'),
      items: sessions,
      getLabel: (s) => `${s.title || s.sessionId?.slice(0, 8) || '?'}  [${s.sessionId?.slice(0, 8) || '?'}]  ${s.turnCount || 0} turns`,
    });
    if (!selected) return;
    const sessionId = typeof selected === 'string' ? selected : selected.sessionId;
    const loadedState = await loadSessionState(sessionId, null);
    if (!loadedState) {
      const { createNewSessionState } = require('../utils/sessionStorage');
      const newState = await createNewSessionState(null);
      Object.assign(state, {
        sessionId: newState.sessionId,
        sessionPath: newState.sessionPath,
        history: newState.history || [],
        memorySummary: newState.memorySummary || '',
        importedMemory: newState.importedMemory || '',
        turnCount: newState.turnCount || 0,
        title: newState.title || 'New session',
      });
      await saveState(state);
      store.addEvent('warn', uiText('session not found, created new', 'sesión no encontrada, creando nueva'), sessionId);
      return;
    }
    if (Array.isArray(loadedState.history)) {
      const lines = [];
      for (const msg of loadedState.history.slice(-20)) {
        if (msg.role === 'user' && msg.content) {
          lines.push(`${String(msg.content).slice(0, 120)}`);
        } else if (msg.role === 'assistant' && msg.content) {
          const text = String(msg.content).trim();
          if (text) lines.push(`  ${text.slice(0, 120)}`);
        } else if (msg.role === 'tool') {
          lines.push(`  ${msg.tool || 'tool'}`);
        }
      }
      if (lines.length > 0) {
        store.addItem({ type: 'system', text: lines.join('\n') });
      }
    }
    store.addEvent('info', uiText('loaded session', 'sesión cargada'), `"${loadedState.title || selected}"`);
    state.sessionId = loadedState.sessionId;
    state.sessionPath = loadedState.sessionPath;
    state.history = loadedState.history || [];
    state.memorySummary = loadedState.memorySummary || '';
    state.importedMemory = loadedState.importedMemory || '';
    state.sessionMemory = loadedState.sessionMemory || {};
    state.actionLog = loadedState.actionLog || [];
    state.turnCount = loadedState.turnCount || 0;
    state.title = loadedState.title || 'New session';
    state.autoApprove = Boolean(loadedState.autoApprove);
    state.activeModel = loadedState.activeModel || '';
    state.language = loadedState.language || '';
    state.personaPrompt = loadedState.personaPrompt || '';
    state.theme = loadedState.theme || '';
    state.settings = loadedState.settings && typeof loadedState.settings === 'object' ? loadedState.settings : {};
    state.transcriptPath = loadedState.transcriptPath || '';
    state.__resumedHistory = (loadedState.history || []).slice();
    state.__compacting = false;
    state.__toolNameShown = false;
    const { saveState } = require('../utils/sessionStorage');
    await saveState(state);
  }

  const processInput = async (input) => {
    if (input === '/transcript') {
      const { readTranscriptEntries } = require('../utils/transcriptStorage');
      const entries = await readTranscriptEntries(state.sessionId);
      store.openTranscript(entries.slice(-50));
      return;
    }
    if (input === '/exit' || input === '/quit') {
      store.pendingExit = true;
      store.addEvent('info', uiText('bye', 'hasta luego'));
      return;
    }

    if (input === '/auth chatgpt login' || input === '/login chatgpt') {
      if (store.authFlow) {
        store.addEvent('info', uiText('Authorization already in progress', 'La autorización ya está en curso'));
        return;
      }
      const { startChatGPTLogin, getChatGPTStatus } = require('../auth/chatgpt');
      const { openChatGPTAuthBrowser } = require('../auth/browser');
      const { refreshChatGPTCatalog } = require('../providers/chatgpt');
      const { resolveAccountModelKey } = require('../providers/model-id');
      try {
        const previous = await getChatGPTStatus();
        const flow = await startChatGPTLogin({ reconnect: previous.connected });
        store.setAuthFlow(flow);
        openChatGPTAuthBrowser(flow.url);
        flow.done.then(async account => {
          store.setAuthFlow(null);
          if (!account.sharing) {
            store.addEvent('warn', uiText('Connected without model authorization', 'Conectado sin autorización de modelos'));
            return;
          }
          const models = await refreshChatGPTCatalog();
          store.addEvent('ok', uiText('ChatGPT connected', 'ChatGPT conectado'), uiText(`${models.length} models available`, `${models.length} modelos disponibles`));
          if (models.length) {
            const selected = await store.requestSelect({
              title: uiText('Choose ChatGPT model', 'Elegir modelo ChatGPT'),
              items: models,
              getLabel: model => `${model.slug}  ·  ${model.label}`,
              getValue: model => model.slug,
            });
            if (selected) {
              state.activeModel = resolveAccountModelKey(selected, MODELS);
              await require('../utils/sessionStorage').saveState(state);
              store.addEvent('ok', uiText('Active model', 'Modelo activo'), selected);
            }
          }
        }).catch(error => {
          store.setAuthFlow(null);
          if (!/cancel/i.test(error.message || '')) store.addEvent('error', uiText('Authentication failed', 'Falló la autenticación'), error.message);
        });
      } catch (error) {
        store.addEvent('error', uiText('Could not start authentication', 'No se pudo iniciar la autenticación'), error.message);
      }
      return;
    }

    if (input === '/undo') {
      const turn = store.undoConversationTurn();
      if (turn && Array.isArray(state.history)) {
        for (let i = state.history.length - 1; i >= 0; i--) {
          const m = state.history[i];
          if ((m.role === 'user' && m.content === turn.user) || (m.role === 'assistant' && m.content === turn.assistant)) {
            state.history.splice(i, 1);
          }
        }
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
      }
      store.addEvent('info', uiText('undo done', 'deshacer hecho'), turn ? shortTextPreview(turn.user, 80) : uiText('nothing to undo', 'nada que deshacer'));
      return;
    }

    if (input === '/redo') {
      const turn = store.redoConversationTurn();
      if (turn) {
        if (Array.isArray(state.history)) {
          state.history.push({ role: 'user', content: turn.user });
          state.history.push({ role: 'assistant', content: turn.assistant });
        }
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
      }
      store.addEvent('info', uiText('redo done', 'rehacer hecho'), turn ? shortTextPreview(turn.user, 80) : uiText('nothing to redo', 'nada que rehacer'));
      return;
    }

    if (input === '/sessions' || input === '/session') {
      await handleSessionsCommand(store, state, input);
      return;
    }

    if (input === '/settings' || input === '/settings show' || input.startsWith('/settings ')) {
      const args = input.slice(10).trim();
      const { DEFAULT_SETTINGS, getSetting, estimateContextTokens, getContextLimit } = require('../config');
      const lang = state.language || 'es';
      state.settings = state.settings || {};
      const refreshTokenDisplay = () => {
        const est = estimateContextTokens(state);
        const lim = getContextLimit(state.activeModel);
        store.setTokenEstimate(est, lim);
        store.setShowThinking(state.settings?.showThinking);
      };

      const SETTINGS_LIST = [
        { key: 'maxToolSteps',         name: 'max-tool-steps',    isFloat: false, min: 0,      max: 50000,     env: 'ZYN_MAX_TOOL_STEPS',         i18nKey: 'settingMaxToolSteps' },
        { key: 'requestTimeoutMs',     name: 'request-timeout',   isFloat: false, min: 5000,   max: 600000,  env: 'ZYN_REQUEST_TIMEOUT_MS',      i18nKey: 'settingRequestTimeout' },
        { key: 'maxHistoryChars',      name: 'max-history',       isFloat: false, min: 0,  max: 200000000, env: 'ZYN_MAX_HISTORY_CHARS',       i18nKey: 'settingMaxHistory' },
        { key: 'maxOutputChars',       name: 'max-output',        isFloat: false, min: 0,   max: 50000000,  env: 'ZYN_MAX_OUTPUT_CHARS',        i18nKey: 'settingMaxOutput' },
        { key: 'maxFileLines',         name: 'max-file-lines',    isFloat: false, min: 100,    max: 100000,  env: 'ZYN_MAX_FILE_LINES',          i18nKey: 'settingMaxFileLines' },
        { key: 'keepRecentMessages',   name: 'keep-recent',       isFloat: false, min: 5,      max: 500,     env: '',                            i18nKey: 'settingKeepRecent' },
        { key: 'autoCompactThreshold', name: 'compact-threshold', isFloat: true,  min: 0.1,    max: 1.0,     env: '',                            i18nKey: 'settingCompactThreshold' },
        { key: 'autoCompactEnabled',   name: 'auto-compact',      isFloat: false, min: 0,      max: 1,       env: '',                            i18nKey: 'settingAutoCompact' },
        { key: 'compactMinMessages',   name: 'compact-min-msgs',  isFloat: false, min: 1,      max: 100,     env: '',                            i18nKey: 'settingCompactMinMessages' },
        { key: 'maxThinkingLines',     name: 'max-thinking-lines',isFloat: false, min: 3,      max: 200,     env: '',                            i18nKey: 'settingMaxThinkingLines' },
        { key: 'showThinking',         name: 'show-thinking',     isFloat: false, min: 0,      max: 1,       env: '',                            i18nKey: 'settingShowThinking' },
        { key: 'providerMaxAttempts',  name: 'provider-attempts', isFloat: false, min: 1,      max: 20,      env: '',                            i18nKey: 'settingProviderAttempts' },
        { key: 'providerRetryDelayMs', name: 'retry-delay',       isFloat: false, min: 500,    max: 30000,   env: 'ZYN_PROVIDER_TIMEOUT_RETRY_DELAY_MS', i18nKey: 'settingRetryDelay' },
        { key: 'maxTokens',            name: 'max-tokens',        isFloat: false, min: 1024,   max: 200000,  env: '',                            i18nKey: 'settingMaxTokens' },
      ];

      if (args === 'reset') {
        state.settings = {};
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
        refreshTokenDisplay();
        store.addEvent('ok', t(lang, 'settingsTitle'), t(lang, 'settingsResetDone'));
        return;
      }

      const current = (s) => getSetting(state, s.key);
      const isDefault = (s) => state.settings[s.key] === undefined;

      const selected = await store.requestSelect({
        title: t(lang, 'settingsTitle'),
        subtitle: t(lang, 'settingsSelectToModify'),
        items: SETTINGS_LIST,
        getLabel: (s) => {
          const val = current(s);
          const unit = (s.key.includes('Timeout') || s.key.includes('Delay')) ? t(lang, 'settingsUnitMs') : '';
          const def = isDefault(s) ? ` (${t(lang, 'settingsDefault')})` : '';
          return `${t(lang, s.i18nKey)}:  ${val}${unit}${def}`;
        },
        isActive: () => false,
      });

      if (!selected) return;

      const val = current(selected);
      const inputResult = await store.requestInput({
        title: t(lang, selected.i18nKey),
        subtitle: `${t(lang, 'settingsCurrent')}: ${val}  |  ${selected.isFloat ? '(0.1-1.0)' : `(${selected.min}-${selected.max})`}`,
        prompt: '>',
      });

      if (inputResult === null || inputResult === undefined) return;

      const raw = String(inputResult).trim();
      if (raw === '' || raw === 'default') {
        delete state.settings[selected.key];
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
        refreshTokenDisplay();
        store.addEvent('ok', t(lang, selected.i18nKey), t(lang, 'settingsDefault'));
        return;
      }

      const parsed = selected.isFloat ? parseFloat(raw) : parseInt(raw, 10);
      if (isNaN(parsed)) {
        store.addEvent('error', t(lang, 'settingsInvalidValue'), raw);
        return;
      }
      if (parsed < selected.min || parsed > selected.max) {
        store.addEvent('error', t(lang, 'settingsOutOfRange'), `${parsed} (${selected.min}-${selected.max})`);
        return;
      }

      state.settings[selected.key] = parsed;
      const { saveState } = require('../utils/sessionStorage');
      await saveState(state);
      refreshTokenDisplay();
      store.addEvent('ok', t(lang, selected.i18nKey), `${parsed} ${t(lang, 'settingsSaved')}`);
      return;
    }

    if (input === '/theme' || input.startsWith('/theme ')) {
      const args = input.slice(6).trim();
      const themes = [
        { key: 'dark', label: 'Dark', bg: '#212823', accent: '#d4a054' },
        { key: 'cappuccino', label: 'Cappuccino', bg: '#f5efe6', accent: '#a0522d' },
        { key: 'light', label: 'Light', bg: '#ffffff', accent: '#d35400' },
        { key: 'coffee', label: 'Coffee', bg: '#2c1e10', accent: '#d4a054' },
        { key: 'gruvbox', label: 'Gruvbox', bg: '#282828', accent: '#fe8019' },
        { key: 'dracula', label: 'Dracula', bg: '#282a36', accent: '#ff79c6' },
        { key: 'nord', label: 'Nord', bg: '#2e3440', accent: '#88c0d0' },
        { key: 'solarized', label: 'Solarized', bg: '#002b36', accent: '#b58900' },
        { key: 'monokai', label: 'Monokai', bg: '#272822', accent: '#f92672' },
        { key: 'tokyoNight', label: 'Tokyo Night', bg: '#1a1b26', accent: '#ff9e64' },
        { key: 'matrix', label: 'Matrix', bg: '#0a0a0a', accent: '#00ff41' },
        { key: 'synthwave', label: 'Synthwave', bg: '#1a1030', accent: '#ff6ec7' },
        { key: 'rosePine', label: 'Rose Pine', bg: '#191724', accent: '#eb6f92' },
        { key: 'catppuccin', label: 'Catppuccin', bg: '#1e1e2e', accent: '#f5c2e7' },
        { key: 'oneDark', label: 'One Dark', bg: '#282c34', accent: '#61afef' },
        { key: 'materialPalenight', label: 'Material Palenight', bg: '#292d3e', accent: '#c792ea' },
        { key: 'cyberpunk', label: 'Cyberpunk', bg: '#0a0a14', accent: '#ff00ff' },
        { key: 'arctic', label: 'Arctic', bg: '#f0f4f8', accent: '#0077cc' },
        { key: 'ember', label: 'Ember', bg: '#1a0f0a', accent: '#ff6633' },
        { key: 'lavender', label: 'Lavender', bg: '#f5f0ff', accent: '#7c3aed' },
        { key: 'midnight', label: 'Midnight', bg: '#0d1117', accent: '#58a6ff' },
        { key: 'sunset', label: 'Sunset', bg: '#1a1020', accent: '#ff6b35' },
        { key: 'ocean', label: 'Ocean', bg: '#0a1628', accent: '#00b4d8' },
        { key: 'vaporwave', label: 'Vaporwave', bg: '#1a0a2e', accent: '#ff71ce' },
      ];

      if (args === 'random') {
        const pick = themes[Math.floor(Math.random() * themes.length)];
        state.theme = pick.key;
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
        if (global.__zynApplyTheme) global.__zynApplyTheme(pick.key);
        store.addEvent('ok', uiText('theme', 'tema'), pick.label);
        return;
      }

      if (args && args !== 'list') {
        const found = themes.find(t => t.key.toLowerCase() === args.toLowerCase());
        if (found) {
          state.theme = found.key;
          const { saveState } = require('../utils/sessionStorage');
          await saveState(state);
          if (global.__zynApplyTheme) global.__zynApplyTheme(found.key);
          store.addEvent('ok', uiText('theme', 'tema'), found.label);
          return;
        }
        store.addEvent('warn', uiText('unknown theme', 'tema desconocido'), args);
        return;
      }

      const current = state.theme || 'dark';
      const selected = await store.requestSelect({
        title: uiText('Select Theme', 'Seleccionar Tema'),
        subtitle: uiText(`Current: ${current}`, `Actual: ${current}`),
        items: themes,
        getLabel: (t) => `${t.key === current ? '> ' : '  '}${t.label}  [${t.bg}]`,
        isActive: (t) => t.key === current,
      });
      if (selected) {
        state.theme = selected.key;
        const { saveState } = require('../utils/sessionStorage');
        await saveState(state);
        if (global.__zynApplyTheme) global.__zynApplyTheme(selected.key);
        store.addEvent('ok', uiText('theme', 'tema'), selected.label);
      }
      return;
    }

    if (input === '/compact') {
      const lang = state.language || 'en';
      const { estimateContextTokens, getContextLimit } = require('../config');
      const ctxLimit = getContextLimit(state.activeModel);
      const est = estimateContextTokens(state);
      const pct = ctxLimit > 0 ? Math.round(est / ctxLimit * 100) : 0;
      const memSize = Array.isArray(state.history) ? state.history.length : 0;

      store.addEvent('info', lang === 'es' ? 'Compactando memoria...' : 'Compacting memory...',
        lang === 'es'
          ? `Comprimiendo ${memSize} mensajes (~${(est/1000).toFixed(0)}K/${(ctxLimit/1000).toFixed(0)}K tokens, ${pct}%)`
          : `Compressing ${memSize} messages (~${(est/1000).toFixed(0)}K/${(ctxLimit/1000).toFixed(0)}K tokens, ${pct}%)`);

      store.setSpinner(lang === 'es' ? 'Compactando...' : 'Compacting...');
      const ui = getUiBindings(store, state);
      const { autoCompact } = require('../core/agent');
      const { saveState } = require('../utils/sessionStorage');
      try {
        await autoCompact(state, ui, { force: true });
        await saveState(state);
        store.setSpinner(null);
        const { estimateContextTokens, getContextLimit } = require('../config');
        store.setTokenEstimate(estimateContextTokens(state), getContextLimit(state.activeModel));
      } catch (err) {
        store.setSpinner(null);
        store.addEvent('error', lang === 'es' ? 'Error al compactar' : 'Compaction error', err.message);
      }
      return;
    }

    if (input === '/thinking on' || input === '/thinking off') {
      const on = input === '/thinking on';
      state.settings = state.settings || {};
      state.settings.showThinking = on ? 1 : 0;
      store.setShowThinking(on);
      const { saveState } = require('../utils/sessionStorage');
      await saveState(state);
      store.addEvent('ok', uiText('Thinking display: ON', 'Pensamiento: ACTIVADO'));
      return;
    }

    if (input.startsWith('/')) {
      const commandName = input.split(' ')[0].slice(1).toLowerCase();
      const lines = [];
      const origLog = console.log;
      const origError = console.error;
      console.log = (...args) => lines.push(stripAnsi(args.join(' ')));
      console.error = (...args) => lines.push(stripAnsi(args.join(' ')));

      try {
        const printMod = require('../cli/print');
        const selectorMod = require('../cli/selector');
        const deps = {
          appendTranscriptEntry,
          applyLoadedState,
          printBanner: printMod.printBanner,
          printHistory: printMod.printHistory,
          printHistoryReplay: printMod.printHistoryReplay,
          printMemory: printMod.printMemory,
          printSession: printMod.printSession,
          printSessions: printMod.printSessions,
          printStatus: printMod.printStatus,
          askSelect: (options) => selectorMod.askSelect(state, deps, options),
          askInput: (options) => selectorMod.askInput(state, deps, options),
          askConfirm: (options) => selectorMod.askConfirm(state, deps, options),
        };

        const handled = await handleLocalCommand(input, state, deps);
        if (handled) {
          if (store.currentModelKey !== state.activeModel) {
            store.currentModelKey = state.activeModel;
            store.lastMeasuredTokens = null;
            state.lastTokenUsage = null;
          }
          store.setTokenEstimate(estimateContextTokens(state), getContextLimit(state.activeModel));
        }
        if (handled && lines.length > 0) {
          const clean = lines.filter(l => l.trim()).join('\n');
          if (clean) for (const item of splitSystemOutput(clean)) store.addItem(item);
        }
        if (!handled) {
          const suggestion = require('../cli/command-suggest').suggestCommand(input.split(/\s+/)[0], SLASH_COMMANDS);
          store.addEvent('warn', uiText('Unknown command', 'Comando desconocido'),
            suggestion ? uiText(`Did you mean /${suggestion}?`, `¿Quisiste escribir /${suggestion}?`) : '/help');
        }
      } catch (err) {
        store.addEvent('error', uiText('error', 'error'), err.message);
      } finally {
        console.log = origLog;
        console.error = origError;
      }
      return;
    }

    store.addItem({ type: 'divider' });
    store.addItem({ type: 'user', text: input });
    store.lastUserMessage = input;

    const origError = console.error;
    console.error = () => {};

    try {
      const controller = new AbortController();
      state.abortCurrentTurn = () => {
        if (!controller.signal.aborted) {
          controller.abort();
          return true;
        }
        return false;
      };
      state.__bgDetach = { input, signal: controller.signal };
      const ui = getUiBindings(store, state);
      const result = await runAgentTurn(input, state, ui, { signal: controller.signal });
      if (result.content) {
        if (!result.rendered) {
          store.addItem({ type: 'answer', text: result.content });
        }
        store.conversationHistory.unshift({ user: input, assistant: result.content, timestamp: Date.now() });
        if (store.conversationHistory.length > 100) store.conversationHistory.pop();
        store.conversationRedo = [];
        store._emit();
      }
      if (typeof ui.syncTokenEstimate === 'function') ui.syncTokenEstimate();
    } catch (err) {
      const aborted = err?.message === 'Aborted' || err?.message?.includes('agotado') || err?.message?.includes('Timeout');
      store.addEvent('error', aborted ? 'warn' : 'error', err.message);
      store.conversationHistory.unshift({ user: input, assistant: aborted ? '(interrumpido)' : `(error: ${err.message})`, timestamp: Date.now() });
      if (store.conversationHistory.length > 100) store.conversationHistory.pop();
      store.conversationRedo = [];
      store._emit();
    } finally {
      console.error = origError;
      state.abortCurrentTurn = null;
      state.__bgDetach = null;
    }
  };

  let appInstance = null;

  const handleSubmit = async (input) => {
    await runSerialInputs({
      store,
      firstInput: input,
      execute: async (next) => {
        if (!next.startsWith('/')) {
          store.pushSubmittedMessage(next);
          store.setInputDraft('');
          store.turnCount += 1;
          store._emit();
        }
        await processInput(next);
      },
      onError: (error) => {
        store.addEvent('error', uiText('command failed', 'comando fallido'), error?.message || String(error));
      },
    });
    if (store.pendingExit && appInstance) appInstance.unmount();
  };

  appInstance = render(h(App, { store, state, onSubmit: handleSubmit }), {
    exitOnCtrlC: false,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  const handleRawInput = chunk => {
    if (String(chunk) === '\x1b\x1b') {
      store.lastEscapeAt = Date.now();
    }
  };
  process.stdin.prependListener('data', handleRawInput);
  try {
    await appInstance.waitUntilExit();
  } finally {
    process.stdin.off('data', handleRawInput);
  }
}
