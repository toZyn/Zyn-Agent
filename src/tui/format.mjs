export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function shortTextPreview(str, maxLen) {
  const s = String(str || '').replace(/\n/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

export function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}
