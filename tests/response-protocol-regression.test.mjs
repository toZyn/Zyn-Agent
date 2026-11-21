import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assistantStreamText } = require('../src/core/stream-text');
const { parseAgentResponse } = require('../src/core/prompts');
const { runChatGPTResponses } = require('../src/providers/chatgpt');

test('hardware-check prose cannot leak following tool JSON at any token boundary', () => {
  const prefix = 'Voy a revisar el hardware disponible.\n';
  const raw = prefix + JSON.stringify({ type: 'tool', tool: 'run_command', args: { command: 'printf CPU; free -h' } });
  for (let i = 1; i <= raw.length; i++) {
    const visible = assistantStreamText(raw.slice(0, i));
    if (visible !== null) assert.ok(!visible.includes('{') && !visible.includes('run_command') && !visible.includes('printf'), `Leaked at ${i}: ${visible}`);
  }
});

test('multiline comments and an indented tool call retain commentary exactly once', () => {
  const first = JSON.stringify({ type: 'comment', content: 'Revisaré RAM y CPU.' }, null, 2);
  const second = JSON.stringify({ type: 'comment', content: 'Después revisaré los modelos.' }, null, 2);
  const tool = JSON.stringify({ type: 'tool', tool: 'run_command', args: { command: 'free -h' } }, null, 2);
  const result = parseAgentResponse(first + '\n\n  ' + second + '\n\n  ' + tool);
  assert.equal(result.type, 'tool');
  assert.deepEqual(result._comments, ['Revisaré RAM y CPU.', 'Después revisaré los modelos.']);
});

test('a final answer followed by action is commentary, not a duplicate final answer', () => {
  const raw = JSON.stringify({ type: 'final', content: 'Esta es mi recomendación provisional.' }) + '\n' + JSON.stringify({ type: 'tool', tool: 'read_agent_messages', args: {} });
  const result = parseAgentResponse(raw);
  assert.equal(result.type, 'tool');
  assert.deepEqual(result._comments, ['Esta es mi recomendación provisional.']);
});

test('distinct Responses output items preserve text boundaries and channels', async () => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { id: 'comment_1', type: 'message', channel: 'commentary' } },
    { type: 'response.output_text.delta', item_id: 'comment_1', output_index: 0, content_index: 0, delta: 'Voy a revisar CPU.' },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'final_1', type: 'message', channel: 'final' } },
    { type: 'response.output_text.delta', item_id: 'final_1', output_index: 1, content_index: 0, delta: 'La RAM disponible es 1.3 GiB.' },
    { type: 'response.completed' },
  ];
  const chunks = [];
  const response = await runChatGPTResponses([], 'fixture', (text, phase, part) => chunks.push({ text, phase, part }), {
    getAccessToken: async () => 'fixture',
    fetcher: async () => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')),
  });
  assert.match(response.text, /CPU\.\n\nLa RAM/);
  assert.equal(chunks[0].part.channel, 'commentary');
  assert.equal(chunks.at(-1).part.channel, 'final');
});

test('Responses message phases remain commentary until a final-answer item', async () => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { id: 'progress', type: 'message', phase: 'commentary' } },
    { type: 'response.output_text.delta', item_id: 'progress', output_index: 0, content_index: 0, delta: 'Voy a revisar.' },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'result', type: 'message', phase: 'final_answer' } },
    { type: 'response.output_text.delta', item_id: 'result', output_index: 1, content_index: 0, delta: 'Listo.' },
    { type: 'response.completed' },
  ];
  const parts = [];
  await runChatGPTResponses([], 'fixture', (text, _, metadata) => parts.push({ text, ...metadata }), {
    getAccessToken: async () => 'fixture', fetcher: async () => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')),
  });
  assert.equal(parts[0].channel, 'commentary');
  assert.equal(parts.at(-1).channel, 'final');
});

test('ordinary JSON examples and literal backslashes are preserved as answer text', () => {
  const text = 'Ejemplo: {"name":"Q4_K_M"}. Ruta C:\\new\\test.';
  assert.equal(assistantStreamText(text), text);
  assert.equal(parseAgentResponse(text).content, text);
});

test('an unfinished command is not recovered into an executable tool call', () => {
  const parsed = parseAgentResponse('Voy a revisar.\n{"type":"tool","tool":"run_command","args":{"command":"printf incomplete');
  assert.notEqual(parsed.type, 'tool');
  assert.equal(parsed.type, 'invalid');
  assert.deepEqual(parsed._comments, ['Voy a revisar.']);
});

test('Responses completed items reconcile their authoritative text and late phase once', async () => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { id: 'progress', type: 'message' } },
    { type: 'response.output_text.delta', item_id: 'progress', output_index: 0, content_index: 0, delta: 'Voy a revisar.' },
    { type: 'response.output_item.done', output_index: 0, item: { id: 'progress', type: 'message', phase: 'commentary', content: [{ type: 'output_text', text: 'Voy a revisar.' }] } },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'answer', type: 'message', phase: 'final_answer' } },
    { type: 'response.output_text.delta', item_id: 'answer', output_index: 1, content_index: 0, delta: 'RAM: 1.' },
    { type: 'response.output_item.done', output_index: 1, item: { id: 'answer', type: 'message', phase: 'final_answer', content: [{ type: 'output_text', text: 'RAM: 1.3 GiB.' }] } },
    { type: 'response.completed' },
  ];
  const parts = new Map();
  const response = await runChatGPTResponses([], 'fixture', (text, _, metadata) => {
    const previous = parts.get(metadata.id);
    parts.set(metadata.id, { text: metadata.replace ? text : (previous?.text || '') + text, channel: metadata.channel });
  }, { getAccessToken: async () => 'fixture', fetcher: async () => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')) });
  assert.equal(response.text, 'Voy a revisar.\n\nRAM: 1.3 GiB.');
  assert.deepEqual([...parts.values()], [{ text: 'Voy a revisar.', channel: 'commentary' }, { text: 'RAM: 1.3 GiB.', channel: 'final' }]);
});

test('all incomplete prefixes of a protocol tool stay out of final prose', () => {
  const raw = '{"type":"tool","tool":"run_command","args":{"command":"printf test"}}';
  for (let i = 1; i < raw.length; i++) {
    const parsed = parseAgentResponse(raw.slice(0, i));
    assert.equal(parsed.type, 'invalid', 'Unsafe prefix: ' + raw.slice(0, i));
  }
});

test('a nested type field in ordinary JSON data is not an assistant control envelope', () => {
  const text = '{"record":{"type":"final","content":"data"}}';
  assert.equal(assistantStreamText(text), text);
  assert.equal(parseAgentResponse(text).content, text);
});

test('malformed single-quoted protocol objects stay out of streamed prose', () => {
  const raw = "{'type':'tool','tool':'run_command','args':{'command':'printf test'}}";
  assert.equal(assistantStreamText(raw), null);
  assert.equal(parseAgentResponse(raw).type, 'invalid');
});
