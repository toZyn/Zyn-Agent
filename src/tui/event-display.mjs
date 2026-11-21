const agentOperation = /\b(spawn_agent|wait_agent|followup_agent|interrupt_agent|close_agent|resume_agent)\b/i;
export function formatEventPreview(event = {}, width = 80) {
  const text = String(event.detail || '').replace(/\t/g, '  ').trim();
  if (!text) return { lines: [], hint: '' };
  if (agentOperation.test(String(event.title || ''))) {
    try {
      const record = JSON.parse(text);
      if (record && typeof record === 'object' && record.agent_id) {
        const identifier = String(record.agent_id).slice(0, 8);
        const role = String(record.role || 'agent');
        const status = String(record.status || (record.closed ? 'closed' : 'started'));
        const result = record.result == null ? '' : typeof record.result === 'string' ? record.result : JSON.stringify(record.result, null, 2);
        return { lines: [role + ' · ' + status + ' · ' + identifier, ...result.split(/\r?\n/).filter(Boolean)], hint: '' };
      }
    } catch {}
  }
  return { lines: text.split(/\r?\n/), hint: '' };
}
