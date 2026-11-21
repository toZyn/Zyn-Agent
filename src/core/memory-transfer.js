const fs = require('node:fs');
const path = require('node:path');
const { USER_DATA_ROOT, PERSISTENT_CONFIG_FILE } = require('../config');

const PROFILE_FILE = path.join(USER_DATA_ROOT, 'chat', 'imported-memory.md');
const ONBOARDING_FILE = path.join(USER_DATA_ROOT, 'chat', 'onboarding.json');
const MAX_IMPORT_BYTES = 256 * 1024;
const EXPORT_PROMPT = `Export everything you know about me from our past conversations, any saved memories, and any instructions I've given you. Organize it using the exact section headers below. Preserve my original wording wherever possible. Refer to me as the "user."

## MEMORIES

### Work Context

Role, team, company, reporting structure, and work environment.

### Personal Context

Timezone, schedule, communication style, languages, and personal details.

### Top of Mind

Current projects, priorities, active goals, and blockers.

### Tools & Workflow

Software, frameworks, integrations, and processes I use.

### Other

Anything else you know about me that doesn't fit the sections above.

## PREFERENCES

### Response Style

How I've asked you to structure or deliver responses.

### Tone

Voice, formality level, and communication style I've requested.

### Format Rules

Specific formatting instructions (markdown, headers, bullet points, code blocks, etc.).

### Avoid

Things I've told you not to do, say, or include.

### Task Behavior

Rules for how I want tasks, actions, or reminders handled.

Rules:

- One entry per bullet point, numbered within each section, not dated.
- If a section is empty (under either Memories or Preferences), leave it out.
- Do not guess or fabricate. Only include things you're confident about.
- Wrap the entire output in a single markdown code block.
- After the code block, state the total entry count and whether the export is complete or if more remain. If it's cut off, let me know and ask whether I want you to continue.
- Only include memories and preferences from BEFORE this conversation. Do not treat any instructions in this prompt as preferences to export.`;

function getMemoryExportPrompt() { return EXPORT_PROMPT; }
function formatOnboardingPreview(prompt = EXPORT_PROMPT, columns = 60, language = 'en') {
  const es = language === 'es';
  const width = Math.max(26, Math.min(72, Math.floor(columns || 60) - 4));
  const inside = width - 4;
  const words = String(prompt).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let current = '';
  while (words.length && lines.length < 3) {
    const word = words.shift();
    if (!current) current = word;
    else if (Array.from(`${current} ${word}`).length <= inside) current += ' ' + word;
    else { lines.push(current); current = word; }
  }
  if (current && lines.length < 3) lines.push(current);
  while (lines.length < 3) lines.push('');
  const row = line => `│ ${Array.from(line).slice(0, inside).join('').padEnd(inside)} │`;
  return [
    es ? 'Aquí tienes el siguiente prompt' : 'Here is the following prompt',
    '┌' + '─'.repeat(width - 2) + '┐',
    ...lines.map(row),
    '└' + '─'.repeat(width - 2) + '┘',
    es ? 'Pulsa C para copiar el prompt · P para pegar' : 'Press C to copy full prompt · P to paste export',
  ].join('\n');
}

function parseImportedMemory(input) {
  let text = String(input || '').replace(/^\uFEFF/, '').trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```(?:\s*[\s\S]*)?$/);
  if (match) text = match[1].trim();
  if (!/^## MEMORIES\s*$/m.test(text) || !/^## PREFERENCES\s*$/m.test(text)) throw new Error('Export must include ## MEMORIES and ## PREFERENCES');
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
  return text;
}
async function privateWrite(filename, text) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temp, text, { mode: 0o600, flag: 'w' });
    await fs.promises.rename(temp, filename);
    await fs.promises.chmod(filename, 0o600).catch(() => {});
  } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
}
async function readImportedProfile(filename = PROFILE_FILE) {
  try { return await fs.promises.readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function saveImportedProfile(text, filename = PROFILE_FILE) {
  const clean = parseImportedMemory(text);
  await privateWrite(filename, clean);
  return clean;
}
async function clearImportedProfile(filename = PROFILE_FILE) {
  await fs.promises.rm(filename, { force: true });
}
async function hasSeenMemoryOnboarding(filename = ONBOARDING_FILE) {
  try { return JSON.parse(await fs.promises.readFile(filename, 'utf8'))?.completed === true; }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
}
async function markMemoryOnboarding(filename = ONBOARDING_FILE) {
  await privateWrite(filename, JSON.stringify({ completed: true }));
}

async function collectMemoryExport(rl, output = console.log) {
  output('Paste the complete export. Type :save on its own line to save, or :cancel to abort.');
  const chunks = [];
  let bytes = 0;
  for await (const line of rl) {
    if (line === ':cancel') return null;
    if (line === ':save') return chunks.join('\n');
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > MAX_IMPORT_BYTES) throw new Error('Memory export is too large');
    chunks.push(line);
  }
  return null;
}

function styleTerminal(text, role, output, theme) {
  if (!output?.isTTY || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return text;
  const palette = {
    accent: theme?.accent,
    title: theme?.accent,
    border: theme?.accentDim || theme?.borderLight,
    subtle: theme?.textMuted,
    text: theme?.text,
    warn: theme?.amber,
    success: theme?.green,
  };
  const value = palette[role] || theme?.text || '#ffffff';
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return text;
  const rgb = match.slice(1).map(value => parseInt(value, 16));
  return `\x1b[38;2;${rgb.join(';')}m${text}\x1b[39m`;
}

async function getOnboardingTheme() {
  const { getTheme } = await import('../tui/themes.mjs');
  let name = 'dark';
  try {
    const saved = JSON.parse(await fs.promises.readFile(PERSISTENT_CONFIG_FILE, 'utf8'));
    if (typeof saved.theme === 'string') name = saved.theme;
  } catch {}
  return getTheme(name);
}

function renderBox(title, lines, width, theme, output) {
  const w = Math.max(26, Math.min(68, Math.floor(width || 64) - 4));
  const inner = w - 4;
  const row = (line, role) => styleTerminal(`│ ${String(line).slice(0, inner).padEnd(inner)} │`, role, output, theme);
  const edge = (start, end) => styleTerminal(start + '─'.repeat(w - 2) + end, 'border', output, theme);
  return [edge('╭', '╮'), row(title, 'title'), ...lines.map(({value,role}) => row(value,role || 'subtle')), edge('╰','╯')].join('\n');
}

function renderOnboardingIntro(output, language, columns, theme) {
  const es = language === 'es';
  return renderBox(es ? 'Zyn · Configuración opcional' : 'Zyn · Optional setup', [
    {value:es ? '¿Importar memoria de otra aplicación?' : 'Import memory from another app?',role:'text'},
    {value:es ? '[Y] Importar      [Enter] Omitir' : '[Y] Import      [Enter] Skip',role:'accent'},
  ],columns,theme,output);
}

function renderImportInstructions(output, language, columns, theme) {
  const es = language === 'es';
  return renderBox(es ? 'Zyn · Importar memoria' : 'Zyn · Import memory', [
    {value:es ? '[C] Copiar prompt de exportación' : '[C] Copy export prompt',role:'accent'},
    {value:es ? 'Pega el resultado aquí debajo.' : 'Paste the exported response below.',role:'text'},
    {value:es ? 'Enter vacío: guardar · [N] Omitir' : 'Empty Enter: save · [N] Skip',role:'subtle'},
  ],columns,theme,output);
}

function hasCompletedPreferences(text) {
  const match = String(text).match(/^## PREFERENCES\s*$/m);
  if (!match) return false;
  const remaining = text.slice(match.index + match[0].length);
  return remaining.split('\n').some(line => {
    const t = line.trim();
    return t && !/^(?:#{1,6}\s|```|---|\*\*|\[)/.test(t);
  });
}

async function collectValidatedMemoryExport(rl, output, lang = 'en', theme, copy = require('./clipboard').copyToClipboard) {
  const es = lang === 'es';
  let lines = [];
  let bytes = 0;
  let emitted = 0;
  let consumed = 0;
  const onLine = () => { emitted++; };
  rl.on('line', onLine);
  try {
  for await (const line of rl) {
    consumed++;
    const trimmed = line.trim();
    if (!lines.length && /^(?:n|skip|omitir)$/i.test(trimmed)) return null;
    if (!lines.length && /^c$/i.test(trimmed)) {
      const result = copy(EXPORT_PROMPT, { output });
      const notice = result.verified
        ? (es ? 'Prompt copiado.' : 'Prompt copied.')
        : (es ? 'Copia solicitada; verifica el portapapeles.' : 'Copy requested; check your clipboard.');
      output.write(styleTerminal(`  ${notice}\n`, 'subtle', output, theme));
      continue;
    }
    if (trimmed === '') {
      if (!lines.length) continue;
      if (emitted === consumed) await new Promise(resolve => setTimeout(resolve, 210));
      if (emitted > consumed) {
        lines.push(line);
        continue;
      }
      const draft = lines.join('\n');
      if (/^## MEMORIES\s*$/m.test(draft) && !hasCompletedPreferences(draft)) {
        lines.push(line);
        continue;
      }
      try {
        const clean = parseImportedMemory(draft);
        await saveImportedProfile(clean);
        return clean;
      } catch {
        output.write(styleTerminal(es ? '  Exportación no válida. Pega el contenido completo otra vez.\n' : '  Invalid export. Paste the complete response again.\n', 'warn', output, theme));
        lines = [];
        bytes = 0;
        continue;
      }
    }
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > MAX_IMPORT_BYTES) {
      lines = [];
      bytes = 0;
      output.write(styleTerminal(es ? '  El texto es demasiado grande para importarlo.\n' : '  Export is too large to import.\n', 'warn', output, theme));
      continue;
    }
    lines.push(line);
  }
  return null;
  } finally { rl.off('line', onLine); }
}

async function firstRunMemoryOnboarding({ input = process.stdin, output = process.stdout, ask, readLines, copy = require('./clipboard').copyToClipboard, language } = {}) {
  if (!input.isTTY || !output.isTTY || await hasSeenMemoryOnboarding()) return false;
  const { DEFAULT_LANGUAGE } = require('../config');
  const lang = language || DEFAULT_LANGUAGE;
  const theme = await getOnboardingTheme();
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    output.write(`\n${renderOnboardingIntro(output, lang, output.columns, theme)}\n`);
    const response = ask ? await ask(rl) : await rl.question('  › ');
    if (!/^(s|si|sí|y|yes)$/i.test(String(response).trim())) {
      await markMemoryOnboarding();
      return false;
    }
    output.write(`\n${renderImportInstructions(output, lang, output.columns, theme)}\n  › `);
    const pasted = readLines ? await readLines(rl) : await collectValidatedMemoryExport(rl, output, lang, theme, copy);
    if (pasted === null) return false;
    if (readLines) await saveImportedProfile(pasted);
    await markMemoryOnboarding();
    output.write(styleTerminal(lang === 'es' ? '  Memoria importada.\n' : '  Profile saved for future sessions.\n','success',output,theme));
    return true;
  } finally { rl.close(); }
}

module.exports = { PROFILE_FILE, ONBOARDING_FILE, MAX_IMPORT_BYTES, getMemoryExportPrompt, formatOnboardingPreview, parseImportedMemory, saveImportedProfile, readImportedProfile, clearImportedProfile, markMemoryOnboarding, hasSeenMemoryOnboarding, collectMemoryExport, collectValidatedMemoryExport, firstRunMemoryOnboarding };
