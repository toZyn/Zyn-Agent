function clean(value) {
  return String(value || '').replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\t/g, '  ');
}
function wrapLine(line, columns) {
  const output = [];
  const chars = Array.from(line);
  const width = Math.max(8, Math.floor(columns));
  if (!chars.length) return [''];
  for (let i = 0; i < chars.length; i += width) output.push(chars.slice(i, i + width).join(''));
  return output;
}
export function confirmationViewport(request = {}, width = 80, height = 24, locale = 'en') {
  const maxWidth = Math.max(8, Math.floor(width) - 8);
  const title = clean(request.title).trim() || (locale === 'es' ? 'Permiso requerido' : 'Permission required');
  const all = clean(request.detail).split('\n').flatMap(line => wrapLine(line, maxWidth));
  const expanded = Boolean(request.expanded);
  const limit = expanded ? Math.max(3, Math.min(8, Math.floor(height) - 9)) : Math.min(3, Math.max(2, Math.floor(height) - 12));
  const offset = expanded ? Math.max(0, Math.min(Number(request.offset || 0), Math.max(0, all.length - limit))) : 0;
  const lines = all.slice(offset, offset + limit);
  const hidden = Math.max(0, all.length - offset - lines.length);
  const footer = expanded
    ? (locale === 'es' ? '↑↓ desplazar · V contraer · Y permitir · N denegar' : '↑↓ scroll · V collapse · Y allow · N deny')
    : (locale === 'es' ? 'V ver detalle · Y permitir · N denegar' : 'V View details · Y allow · N deny');
  return { title, lines, hidden, footer, expanded, offset, total: all.length };
}
