function distance(a, b) {
  const rows = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = rows[0];
    rows[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const original = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = original;
    }
  }
  return rows[b.length];
}
function suggestCommand(input, commands = []) {
  const name = String(input || '').replace(/^\//, '').trim().toLowerCase();
  if (!name || name.length > 60) return null;
  const matches = commands.map(command => typeof command === 'string' ? command : command.name)
    .map(command => ({command, distance: distance(name, command)}))
    .filter(item => item.distance > 0 && item.distance <= (name.length < 5 ? 1 : 2))
    .sort((a, b) => a.distance - b.distance || a.command.localeCompare(b.command));
  return matches[0]?.command || null;
}
module.exports = {distance,suggestCommand};
