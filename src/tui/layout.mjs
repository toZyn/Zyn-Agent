export function layoutForWidth(width) {
  const columns = Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width)) : 1;
  const compact = columns < 48;
  const inputPadding = compact ? 1 : 3;
  return {
    columns,
    compact,
    frameWidth: Math.min(72, Math.max(0, columns - 2)),
    inputPadding,
    inputColumns: Math.max(1, columns - 2 * inputPadding - 4),
    statusWidth: Math.max(1, columns - 4),
  };
}
