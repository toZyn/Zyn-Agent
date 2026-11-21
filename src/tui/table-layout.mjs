function displayWidth(text) {
  let width = 0;
  for (const value of String(text)) {
    const code = value.codePointAt(0);
    if (/\p{Mark}/u.test(value)) continue;
    width += code >= 0x1100 && (
      code <= 0x115f || code >= 0x2329 && code <= 0x232a ||
      code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3 ||
      code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe19 ||
      code >= 0xfe30 && code <= 0xfe6f || code >= 0xff00 && code <= 0xff60 ||
      code >= 0xffe0 && code <= 0xffe6 || code >= 0x1f300 && code <= 0x1faff
    ) ? 2 : 1;
  }
  return width;
}
function clip(text, max) {
  if (displayWidth(text) <= max) return text;
  let result = '';
  for (const letter of String(text)) {
    if (displayWidth(result + letter) > Math.max(0, max - 1)) break;
    result += letter;
  }
  return result + '…';
}
function pad(text, max) {
  const truncated = clip(text, max);
  return truncated + ' '.repeat(Math.max(0, max - displayWidth(truncated)));
}
function splitRow(row) {
  const trimmed = String(row ?? '').trim();
  const separator = trimmed.includes('│') ? '│' : '|';
  const raw = trimmed.split(separator);
  if (raw[0].trim() === '') raw.shift();
  if (raw.at(-1)?.trim() === '') raw.pop();
  return raw.map(value => value.trim());
}
function separatorRow(row) {
  return row.every(value => /^:?-{3,}:?$/.test(value));
}
export function formatTerminalTable(rawRows, width = 80) {
  const rows = rawRows.map(splitRow).filter(row => row.length > 1 && !separatorRow(row));
  if (!rows.length) return { mode: 'empty', lines: [] };
  const count = Math.max(...rows.map(row => row.length));
  const max = Math.max(12, Math.floor(width));
  const padded = rows.map(row => Array.from({ length: count }, (_, index) => String(row[index] ?? '')));
  const widths = Array.from({ length: count }, (_, i) => Math.max(...padded.map(row => displayWidth(row[i]))));
  const spacing = (count - 1) * 3;
  const total = widths.reduce((sum, n) => sum + n, 0) + spacing;
  if (total <= max) {
    return { mode: 'columns', lines: padded.map(row => row.map((cell, i) => pad(cell, widths[i])).join(' │ ')) };
  }
  if (count > 3 || max < count * 7 + spacing) {
    const headers = padded[0];
    return {
      mode: 'cards',
      lines: padded.slice(1).flatMap((row, index) => [
        ...(index ? [''] : []),
        ...row.map((cell, i) => clip(headers[i] || 'Column ' + (i + 1), Math.min(14, max - 5)) + ': ' + cell),
      ]),
    };
  }
  const allocated = widths.map(w => Math.max(5, Math.floor((max - spacing) * (w / (total - spacing)))));
  while (allocated.reduce((sum, n) => sum + n, 0) + spacing > max) {
    const longest = allocated.indexOf(Math.max(...allocated));
    allocated[longest]--;
  }
  return { mode: 'columns', lines: padded.map(row => row.map((cell, i) => pad(cell, allocated[i])).join(' │ ')) };
}
export { displayWidth };
