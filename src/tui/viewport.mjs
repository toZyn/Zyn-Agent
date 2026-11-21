import { formatEventPreview } from './event-display.mjs';
import { formatTerminalTable, displayWidth } from './table-layout.mjs';
export const DEFAULT_VISIBLE_ITEMS = Infinity;

export function appendVisibleItem(items, item, limit = DEFAULT_VISIBLE_ITEMS) {
  const max = Number.isInteger(limit) && limit > 0
    ? limit
    : DEFAULT_VISIBLE_ITEMS;
  return max === Infinity ? [...items, item] : [...items.slice(-(max - 1)), item];
}

function estimateWrappedLines(text, columns) {
  const width = Math.max(8, columns - 10);
  const lines = String(text ?? '').split('\n');
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const markdown = lines[i].includes('|') && i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]);
    const unicode = lines[i].includes('│') && i + 1 < lines.length &&
      lines[i + 1].includes('│');
    if (markdown || unicode) {
      const table = [lines[i]];
      if (markdown) i++;
      while (i + 1 < lines.length && lines[i + 1].trim() &&
        (lines[i + 1].includes('|') || lines[i + 1].includes('│'))) {
        table.push(lines[++i]);
      }
      const formatted = formatTerminalTable(table, Math.max(12, columns - 16));
      total += formatted.lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(displayWidth(line) / width)), 0);
      continue;
    }
    total += Math.max(1, Math.ceil(displayWidth(lines[i]) / width));
  }
  return total;
}

function estimateItemRows(item, columns) {
  switch (item.type) {
    case 'banner': return columns < 18 ? 2 : 6;
    case 'divider': return 1;
    case 'event': {
      const view = formatEventPreview(item, columns);
      if (/\b(spawn_agent|wait_agent|followup_agent|resume_agent|close_agent|interrupt_agent)\b/.test(String(item.title || ''))) {
        return 4 + view.lines.length;
      }
      return 1 + view.lines.length + (view.hint ? 1 : 0) + (item.kind === 'comment' ? 1 : 0);
    }
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
