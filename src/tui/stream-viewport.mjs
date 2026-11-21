import { displayWidth } from './table-layout.mjs';

export function visibleStreamTail(text, columns = 80, maxRows = 12) {
  const lines = String(text || '').split(/\r?\n/);
  const width = Math.max(10, Math.floor(columns) || 80);
  const limit = Math.max(2, Math.floor(maxRows) || 12);
  const picked = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const rows = Math.max(1, Math.ceil(displayWidth(line) / width));
    if (used + rows > limit) {
      if (picked.length) break;
      const available = Math.max(1, limit * width - 1);
      const tail = [];
      let cells = 0;
      for (const part of Array.from(line).reverse()) {
        const size = displayWidth(part);
        if (cells + size > available) break;
        tail.push(part);
        cells += size;
      }
      picked.unshift('…' + tail.reverse().join(''));
      break;
    }
    picked.unshift(line);
    used += rows;
    if (used >= limit) break;
  }
  return picked.join('\n');
}
