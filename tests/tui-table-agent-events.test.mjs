import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTerminalTable, displayWidth } from '../src/tui/table-layout.mjs';
import { formatEventPreview } from '../src/tui/event-display.mjs';

const storage = [
  'Partición │ Total │ Usado │ Disponible │ Uso',
  '/ │ 109 GB │ 30 GB │ 79 GB │ 28 %',
];
test('Unicode pipe table stays aligned in a normal mobile terminal', () => {
  const result = formatTerminalTable(storage, 52);
  assert.equal(result.mode, 'columns');
  assert.equal(result.lines.length, 2);
  const spans = result.lines.map(line => [...line.matchAll(/│/g)].map(m => displayWidth(line.slice(0, m.index))));
  assert.deepEqual(spans[0], spans[1]);
  assert.ok(result.lines.every(line => displayWidth(line) <= 52));
});

test('narrow layout uses readable vertical cells without losing any values', () => {
  const result = formatTerminalTable(storage, 28);
  assert.equal(result.mode, 'cards');
  assert.match(result.lines.join('\n'), /Disponible: 79 GB/);
  assert.match(result.lines.join('\n'), /Partición: \//);
  assert.ok(result.lines.every(line => displayWidth(line) <= 28));
});

test('Markdown pipe tables and separators parse consistently', () => {
  const rows = ['| Type | Value |', '| --- | --- |', '| RAM | 3.7 GiB |'];
  const result = formatTerminalTable(rows, 36);
  assert.deepEqual(result.lines, ['Type │ Value  ', 'RAM  │ 3.7 GiB']);
});

test('agent tool events use concise status, not raw JSON', () => {
  const detail = JSON.stringify({ agent_id: 'b4f231bf-e618-47cd-a9b7-61415440db02', role: 'general', status: 'completed', task: 'Check hardware', result: 'Long private result' });
  const event = formatEventPreview({ kind: 'ok', title: 'Completed wait_agent', detail }, 52);
  assert.deepEqual(event.lines, ['general · completed · b4f231bf']);
  assert.equal(event.hint, '');
});
