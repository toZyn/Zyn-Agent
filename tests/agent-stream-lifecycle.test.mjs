import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zyn-protocol-'));
process.env.ZYN_DATA_DIR = directory;
const { UIStore } = await import('../src/tui/store.mjs');
const require = createRequire(import.meta.url);
const { MODELS } = require('../src/config');
const network = require('../src/providers/scraperClient');
const originalChat = network.chat;
const observations = [];
let replies = [];
let calls = 0;
network.chat = async ({ onChunk }) => {
  calls++;
  const reply = replies.shift();
  assert.ok(reply, 'Unexpected additional provider request');
  for (const chunk of reply.chunks || Array.from(reply.text)) {
    if (typeof chunk === 'string') onChunk?.(chunk, 'answer');
    else onChunk?.(chunk.text, 'answer', chunk.metadata);
    await new Promise(resolve => setImmediate(resolve));
  }
  if (reply.error) throw new Error(reply.error);
  return { answer: reply.text, thinking: '', usage: null };
};
const corePath = require.resolve('../src/core/agent');
delete require.cache[corePath];
const { runAgentTurn } = require(corePath);
MODELS['protocol-fixture'] = { provider: 'chatgpt', modelId: 'fixture' };

function context() {
  const store = new UIStore();
  const state = { sessionId: 'protocol-' + Date.now(), cwd: directory, sessionPath: path.join(directory, 'session.json'), history: [], settings: { providerMaxAttempts: 2, providerRetryDelayMs: 1 }, language: 'es', turnCount: 0, activeModel: 'protocol-fixture', title: 'New session', tuiConfirm: async () => true };
  const ui = {
    beginThinkingStream: () => store.beginThinking(), writeThinkingDelta: (_, text) => store.appendThinking(text), endThinkingStream: () => store.endThinking(),
    beginAssistantStream: () => store.beginAnswer(), writeAssistantDelta: (_, text) => store.appendAnswer(text), endAssistantStream: () => store.endAnswer(),
    upsertAssistantPart: (_, part) => store.upsertAssistantPart(part),
    logEvent: (_, kind, title, detail) => store.addEvent(kind, title, detail),
    startThinkingIndicator: (_, label) => { store.setSpinner(label); return () => store.setSpinner(null); },
    pushAction() {}, paint: text => text,
  };
  store.on('update', () => observations.push(JSON.stringify({ items: store.items.filter(part => part.type === 'answer' || part.type === 'comment'), live: store.liveAnswer })));
  return { store, state, ui };
}

test('actual turn separates pre-tool commentary from exactly one final answer', async () => {
  const { store, state, ui } = context();
  replies = [
    { text: 'Voy a revisar el hardware disponible.\n' + JSON.stringify({ type: 'tool', tool: 'run_command', args: { command: "printf 'HARDWARE_OK'" } }) },
    { text: JSON.stringify({ type: 'comment', content: 'Ya comprobé el hardware.' }) + '\n' + JSON.stringify({ type: 'final', content: 'Disponible: **1.3 GiB**.' }) },
  ];
  const result = await runAgentTurn('Inspecciona mi equipo con una herramienta', state, ui);
  assert.equal(result.content, 'Disponible: **1.3 GiB**.');
  assert.equal(result.rendered, true);
  assert.deepEqual(store.items.filter(p => p.type === 'answer').map(p => p.text), ['Disponible: **1.3 GiB**.']);
  const comments = store.items.filter(p => p.type === 'comment' || p.kind === 'comment').map(p => p.text || p.title);
  assert.deepEqual(comments, ['Voy a revisar el hardware disponible.', 'Ya comprobé el hardware.']);
  assert.ok(observations.every(snapshot => !snapshot.includes('\\"type\\":\\"tool\\"') && !snapshot.includes('printf')));
});

test('command output keeps complete lines in its dedicated tool event', async () => {
  const { store, state, ui } = context();
  const payload = 'first line\n' + 'data '.repeat(100) + '\nEND_OF_RESULT';
  const command = "printf '%s' '" + payload + "'";
  replies = [
    { text: JSON.stringify({ type: 'tool', tool: 'run_command', args: { command } }) },
    { text: JSON.stringify({ type: 'final', content: 'Leído.' }) },
  ];
  await runAgentTurn('Lee el informe', state, ui);
  const event = store.items.find(part => part.kind === 'ok' && part.detail?.includes('Exit code:'));
  assert.ok(event);
  assert.ok(event.detail.includes(payload), event.detail);
});

test('visible progress followed by transport failure is not transparently replayed', async () => {
  const { store, state, ui } = context();
  calls = 0;
  replies = Array.from({ length: 2 }, () => ({ text: JSON.stringify({ type: 'comment', content: 'Voy a revisar la CPU.' }), error: 'Provider disconnected' }));
  await assert.rejects(runAgentTurn('Examina el equipo', state, ui), /Provider disconnected/);
  assert.equal(calls, 1);
  assert.equal(store.items.filter(p => p.type === 'comment' || p.kind === 'comment').length, 1);
});

test.after(() => {
  network.chat = originalChat;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('empty model output terminates once instead of entering a commentary loop', async () => {
  const { state, ui } = context();
  calls = 0;
  replies = [{ text: '' }];
  const result = await runAgentTurn('Responde una pregunta', state, ui);
  assert.equal(result.content, '(respuesta vacía)');
  assert.equal(calls, 1);
});

test('provider commentary phase does not end the turn even with a final JSON envelope', async () => {
  const { store, state, ui } = context();
  const progress = JSON.stringify({ type: 'final', content: 'Voy a revisar la CPU.' });
  calls = 0;
  replies = [
    { text: progress, chunks: [{ text: progress, metadata: { id: 'progress', channel: 'commentary' } }] },
    { text: JSON.stringify({ type: 'final', content: 'Revisión completada.' }) },
  ];
  const result = await runAgentTurn('Revisa CPU', state, ui);
  assert.equal(result.content, 'Revisión completada.');
  assert.equal(calls, 2);
  assert.deepEqual(store.items.filter(p => p.type === 'comment').map(p => p.text), ['Voy a revisar la CPU.']);
  assert.deepEqual(store.items.filter(p => p.type === 'answer').map(p => p.text), ['Revisión completada.']);
});

test('an incomplete final envelope is not committed as an extra final answer', async () => {
  const { store, state, ui } = context();
  replies = [
    { text: '{"type":"final","content":"Informe parcial' },
    { text: JSON.stringify({ type: 'final', content: 'Informe completo.' }) },
  ];
  const result = await runAgentTurn('Explica el resultado', state, ui);
  assert.equal(result.content, 'Informe completo.');
  assert.deepEqual(store.items.filter(p => p.type === 'answer').map(p => p.text), ['Informe completo.']);
});

test('direct commands render their final answer exactly once through the same lifecycle', async () => {
  const { store, state, ui } = context();
  replies = [{ text: JSON.stringify({ type: 'final', content: 'DIRECT_OK: comando completado.' }) }];
  const result = await runAgentTurn('ejecuta el comando printf DIRECT_OK', state, ui);
  assert.equal(result.rendered, true);
  assert.deepEqual(store.items.filter(p => p.type === 'answer').map(p => p.text), ['DIRECT_OK: comando completado.']);
});
