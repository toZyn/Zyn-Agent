function objectEnd(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return i + 1;
  }
  return -1;
}

function protocolKind(record) {
  if (!record || typeof record !== 'object') return null;
  if (['comment', 'final', 'tool'].includes(record.type)) return record.type;
  return typeof record.tool === 'string' && record.args ? 'tool' : null;
}

function partialContent(text) {
  const match = text.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/s);
  if (!match) return '';
  let value = match[1];
  const incomplete = value.match(/\\u[0-9a-fA-F]{0,3}$/);
  if (incomplete) {
    let slashes = 0;
    for (let i = incomplete.index - 1; i >= 0 && value[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 0) value = value.slice(0, incomplete.index);
  }
  try { return JSON.parse('"' + value + '"'); } catch { return ''; }
}

function mergeTextParts(parts) {
  const result = [];
  for (const part of parts) {
    const previous = result.at(-1);
    if (part.type === 'text' && previous?.type === 'text' && previous.id + previous.content.length === part.id) {
      previous.content += part.content;
      previous.complete = part.complete;
    } else result.push({ ...part });
  }
  return result;
}

function scanAssistantParts(value, { finished = false } = {}) {
  const text = String(value || '');
  const parts = [];
  let cursor = 0;
  let proseStart = 0;
  const prose = end => {
    const content = text.slice(proseStart, end);
    if (content.trim()) parts.push({ id: proseStart, type: 'text', content, complete: end < text.length || finished });
  };
  while (cursor < text.length) {
    if (text.startsWith('```', cursor)) {
      prose(cursor);
      const headerEnd = text.indexOf('\n', cursor + 3);
      if (headerEnd < 0) break;
      const endFence = text.indexOf('```', headerEnd + 1);
      const bodyEnd = endFence < 0 ? text.length : endFence;
      const body = text.slice(headerEnd + 1, bodyEnd).trimStart();
      const envelope = body.startsWith('{') && (/^\{\s*"(?:type|tool)"\s*:/.test(body) || /^\{\s*(?:"(?:t(?:y(?:p(?:e)?)?)?|tool)?"?)?$/.test(body));
      if (envelope) {
        const inner = scanAssistantParts(body, { finished: endFence >= 0 || finished });
        for (const part of inner) parts.push({ ...part, id: cursor + part.id });
      } else {
        const end = endFence < 0 ? text.length : endFence + 3;
        parts.push({ id: cursor, type: 'text', content: text.slice(cursor, end), complete: endFence >= 0 || finished });
      }
      cursor = endFence < 0 ? text.length : endFence + 3;
      proseStart = cursor;
      continue;
    }
    if (text[cursor] === '{') {
      prose(cursor);
      const end = objectEnd(text, cursor);
      const candidate = text.slice(cursor, end < 0 ? undefined : end);
      let record;
      if (end >= 0) {
        try { record = JSON.parse(candidate); } catch {}
      }
      const type = protocolKind(record) || (!record ? (candidate.match(/['"]?type['"]?\s*:\s*['"](comment|final|tool)['"]/) || [])[1] : null);
      if (type) {
        parts.push({ id: cursor, type, content: type === 'tool' ? '' : (typeof record?.content === 'string' ? record.content : partialContent(candidate)), record, complete: end >= 0 });
      } else {
        const key = candidate.match(/^\{\s*"([^"\n]*)/);
        const pending = end < 0 && (!key || ['type', 'tool', 'args', 'content'].some(name => name.startsWith(key[1])));
        if (pending) parts.push({ id: cursor, type: 'incomplete', content: '', complete: false });
        else if (end >= 0 || finished) parts.push({ id: cursor, type: 'text', content: candidate, complete: end >= 0 || finished });
      }
      if (end < 0) return mergeTextParts(parts);
      cursor = end;
      proseStart = cursor;
      continue;
    }
    cursor++;
  }
  if (cursor === text.length) {
    const tail = !finished ? (text.slice(proseStart).match(/`{1,2}$/) || [''])[0].length : 0;
    prose(text.length - tail);
  }
  return mergeTextParts(parts);
}

function classifyAssistantParts(parts) {
  const action = parts.findLast(part => part.type === 'tool' || part.type === 'final' || part.type === 'incomplete');
  return parts.map(part => ({
    ...part,
    type: part.channel === 'commentary' && part.type !== 'tool' ? 'comment' : part.type === 'text' ? (action || part.channel === 'commentary' ? 'comment' : 'answer')
      : part.type === 'final' ? (action === part ? 'answer' : 'comment') : part.type,
  }));
}

module.exports = { scanAssistantParts, classifyAssistantParts };
