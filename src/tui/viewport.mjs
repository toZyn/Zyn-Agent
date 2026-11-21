export const DEFAULT_VISIBLE_ITEMS = 400;

export function appendVisibleItem(items, item, limit = DEFAULT_VISIBLE_ITEMS) {
  const max = Number.isInteger(limit) && limit >= 100 && limit <= 5000
    ? limit
    : DEFAULT_VISIBLE_ITEMS;
  return [...items.slice(-(max - 1)), item];
}

function estimateWrappedLines(text, columns) {
  const width = Math.max(8, columns - 10);
  return String(text ?? '').split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0);
}

function estimateItemRows(item, columns) {
  switch (item.type) {
    case 'banner': return columns < 18 ? 2 : 6;
    case 'divider': return 1;
    case 'event': return 1 + (item.detail ? estimateWrappedLines(item.detail, columns) : 0);
    case 'user': return 2 + estimateWrappedLines(item.text, columns);
    case 'answer': return 2 + estimateWrappedLines(item.text, columns);
    case 'thinking': return item.expanded ? 2 + estimateWrappedLines(item.text, columns) : 2;
    case 'system': return estimateWrappedLines(item.text, columns);
    case 'queued': return 2 + estimateWrappedLines(item.text, columns);
    default: return 1;
  }
}

export function selectViewportItems(items, { columns = 80, rows = 20, offset = 0 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const maxRows = Math.max(1, Math.floor(Number.isFinite(rows) ? rows : 20));
  const columnsSafe = Math.max(8, Math.floor(Number.isFinite(columns) ? columns : 80));
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const last = Math.max(0, items.length - 1 - safeOffset);
  let first = last;
  let total = 0;
  for (let i = last; i >= 0; i--) {
    const rowsRequired = estimateItemRows(items[i], columnsSafe);
    if (total + rowsRequired > maxRows && i < last) break;
    first = i;
    total += rowsRequired;
    if (total >= maxRows) break;
  }
  return items.slice(first, last + 1);
}
