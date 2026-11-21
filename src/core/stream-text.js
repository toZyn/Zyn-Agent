function assistantStreamText(raw) {
  const original = String(raw || '');
  let text = original.trimStart();
  if (!text) return null;
  if (!text.startsWith('{')) return original;
  const parts = text.split(/\n(?=\s*\{)/);
  text = parts[parts.length - 1].trim();
  if (!/"type"\s*:\s*"final"/.test(text)) return null;
  const match = text.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)("?)/s);
  if (!match) return null;
  let value = match[1];
  const partialUnicode = value.match(/\\u[0-9a-fA-F]{0,3}$/);
  if (partialUnicode) {
    let slashes = 0;
    for (let i = partialUnicode.index - 1; i >= 0 && value[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) value = value.slice(0, partialUnicode.index);
  }
  try { return JSON.parse('"' + value + '"'); } catch { return null; }
}
module.exports = { assistantStreamText };
