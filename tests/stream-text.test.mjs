import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { assistantStreamText } = createRequire(import.meta.url)('../src/core/stream-text');
test('every chunk preserves final answer characters and JSON escapes', () => {
  const answer = 'RAM: 3.7 GiB\n' + 'texto largo '.repeat(400) + ' "fin"';
  const raw = JSON.stringify({ type: 'final', content: answer });
  let previous = '';
  for (let i = 1; i <= raw.length; i++) {
    const current = assistantStreamText(raw.slice(0, i));
    if (current === null) continue;
    assert.ok(current.startsWith(previous));
    previous = current;
  }
  assert.equal(previous, answer);
});
test('comments and tools stay separate from the visible answer', () => {
  assert.equal(assistantStreamText('{"type":"tool","tool":"spawn_agent"}'), null);
  assert.equal(assistantStreamText('{"type":"comment","content":"Preparando"}\n{"type":"final","content":"Listo"}'), 'Listo');
  assert.equal(assistantStreamText('Respuesta normal'), 'Respuesta normal');
});

test('literal backslashes and incomplete Unicode escapes survive streaming', () => {
  for (const answer of ['C:\\temp\\', 'literal \\u123', '\t\n"fin"']) {
    const raw = JSON.stringify({ type: 'final', content: answer });
    assert.equal(assistantStreamText(raw), answer);
  }
  assert.equal(assistantStreamText('{"type":"final","content":"hola \\u12'), 'hola ');
});
