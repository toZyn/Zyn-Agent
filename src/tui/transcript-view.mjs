function cleanTranscriptLine(value) {
  return String(value || '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\t/g, '  ');
}

export function prepareTranscriptLines(raw, width = 80) {
  const columns = Math.max(10, Math.floor(width) - 6);
  const content = String(raw || '').split(/\r?\n/);
  return content.flatMap(line => {
    const letters = Array.from(cleanTranscriptLine(line));
    if (!letters.length) return [''];
    const rows = [];
    for (let start = 0; start < letters.length; start += columns) {
      rows.push(letters.slice(start, start + columns).join(''));
    }
    return rows;
  });
}

function clipLine(line, limit) {
  const letters = Array.from(String(line));
  return letters.length > limit ? letters.slice(0, limit - 1).join('') + '…' : String(line);
}

function previewText(text) {
  return cleanTranscriptLine(String(text ?? '').replace(/\s+/g, ' ')).trim();
}

export function prepareTranscriptEntryLines(entries, width = 80) {
  const maxWidth = Math.max(10, Math.floor(width) - 6);
  const lines = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const label = entry.tool || entry.type || 'entry';
    const time = String(entry.at || '').slice(11, 19);
    lines.push(clipLine(`${time ? time + ' · ' : ''}${label}`, maxWidth));
    if (entry.args && Object.keys(entry.args).length) {
      lines.push(clipLine(`  ${previewText(JSON.stringify(entry.args))}`, maxWidth));
    }
    const content = entry.type === 'tool' ? entry.result : entry.type === 'tool_error' ? entry.error : entry.content;
    if (content !== null && content !== undefined && String(content)) {
      lines.push(clipLine(`  ${previewText(content)}`, maxWidth));
    }
    lines.push('');
  }
  return lines.length ? lines : ['No transcript yet'];
}

export function transcriptViewport(view, width = 80, height = 24) {
  const lines = Array.isArray(view?.entries) ? prepareTranscriptEntryLines(view.entries, width) : prepareTranscriptLines(view?.text ?? '', width);
  const capacity = Math.max(2, Math.floor(height) - 4);
  const maxOffset = Math.max(0, lines.length - capacity);
  const offset = Math.min(maxOffset, Math.max(0, Math.floor(view?.offset || 0)));
  const end = Math.max(0, lines.length - offset);
  const start = Math.max(0, end - capacity);
  return { lines: lines.slice(start, end), offset, maxOffset, total: lines.length, capacity, start, end };
}
