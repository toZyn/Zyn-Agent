export function splitSystemOutput(content, maxLines = 5) {
  const lines = String(content ?? '').split('\n');
  const chunkSize = Number.isInteger(maxLines) && maxLines > 0 ? Math.min(maxLines, 100) : 5;
  const pieces = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    pieces.push({ type: 'system', text: lines.slice(i, i + chunkSize).join('\n') });
  }
  return pieces;
}
