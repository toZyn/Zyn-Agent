export function sanitizeInputChunk(input) {
  return String(input || '')
    .replace(/\u001b\[200~/g, '')
    .replace(/\u001b\[201~/g, '')
    .replace(/\[200~/g, '')
    .replace(/\[201~/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001bP[\s\S]*?\u001b\\/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function normalizeInputEvent(input, key = {}) {
  const raw = String(input ?? '');
  const bracketed = /\x1b\[200~|\x1b\[201~/.test(raw);
  const submit = Boolean(key.return || (!bracketed && /[\r\n]$/.test(raw)));
  const body = submit ? raw.replace(/[\r\n]+$/, '') : raw;
  const cleaned = sanitizeInputChunk(body);
  const text = cleaned.replace(/\n+/g, ' ');
  return { text, submit, paste: text.length > 1 || /[\r\n]/.test(body) || bracketed };
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function boundaries(value) {
  return [0, ...Array.from(graphemeSegmenter.segment(value), part => part.index + part.segment.length)];
}

export function moveCursor(value, cursor, direction) {
  const points = boundaries(String(value));
  if (direction < 0) return points.filter(position => position < cursor).at(-1) ?? 0;
  return points.find(position => position > cursor) ?? String(value).length;
}

export function editDelete(value, cursor, direction) {
  const text = String(value);
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  if (direction === 'backward') {
    if (safeCursor === 0) return { value: text, cursor: safeCursor };
    const start = moveCursor(text, safeCursor, -1);
    return { value: text.slice(0, start) + text.slice(safeCursor), cursor: start };
  }
  if (safeCursor === text.length) return { value: text, cursor: safeCursor };
  const end = moveCursor(text, safeCursor, 1);
  return { value: text.slice(0, safeCursor) + text.slice(end), cursor: safeCursor };
}

export function splitSubmittedInput(input, key = {}) {
  const raw = String(input ?? '');
  if (key.return || /\x1b\[200~|\x1b\[201~/.test(raw)) return null;
  if (!/[\r\n]/.test(raw)) return null;
  const parts = raw.split(/\r\n|\r|\n/);
  if (parts.length === 2 && parts[1] === '') return null;
  if (parts.length === 2 && !raw.includes('\r')) return null;
  const cleaned = part => sanitizeInputChunk(part).replace(/\n+/g, ' ');
  return { complete: parts.slice(0, -1).map(cleaned), rest: cleaned(parts.at(-1)) };
}

export function mouseWheelSteps(input) {
  const pattern = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
  let steps = 0;
  for (const match of String(input ?? '').matchAll(pattern)) {
    const button = Number(match[1]);
    if ((button & 64) !== 64) continue;
    steps += (button & 1) ? -1 : 1;
  }
  return steps;
}
