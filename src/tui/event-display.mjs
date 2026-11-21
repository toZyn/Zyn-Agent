function shorten(line, limit) {
  const letters = Array.from(String(line));
  return letters.length > limit ? letters.slice(0, Math.max(1, limit - 1)).join('') + '…' : String(line);
}
const agentOperation = /\b(spawn_agent|wait_agent|followup_agent|interrupt_agent|close_agent|resume_agent)\b/i;
export function formatEventPreview(event = {}, width = 80) {
  const max = Math.max(10, Math.floor(width) - 10);
  const text = String(event.detail || '').replace(/\t/g, '  ').trim();
  if (!text) return { lines: [], hint: '' };
  if (agentOperation.test(String(event.title || ''))) {
    try {
      const record = JSON.parse(text);
      if (record && typeof record === 'object' && record.agent_id) {
        const identifier = String(record.agent_id).slice(0, 8);
        const role = String(record.role || 'agent');
        const status = String(record.status || (record.closed ? 'closed' : 'started'));
        return { lines: [shorten(role + ' · ' + status + ' · ' + identifier, max)], hint: '' };
      }
    } catch {}
  }
  const rawLines = text.split(/\r?\n/).filter(Boolean);
  const lines = rawLines.slice(0, 2).map(line => shorten(line, max));
  const reduced = rawLines.length > 2 || lines.some((line, i) => line !== rawLines[i]);
  return { lines, hint: reduced ? '↳ /transcript · full output' : '' };
}
