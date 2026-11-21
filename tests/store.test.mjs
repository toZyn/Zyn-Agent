import test from 'node:test';
import assert from 'node:assert/strict';
import { UIStore } from '../src/tui/store.mjs';

test('the store retains only the latest visible items', () => {
  const store = new UIStore((en) => en);
  for (let i = 0; i < 900; i++) store.addItem({ type: 'event', title: String(i) });
  assert.equal(store.items.length, 400);
  assert.equal(store.items[0].title, '500');
  assert.equal(store.items.at(-1).title, '899');
});

test('selection cancellation resolves the waiting command', async () => {
  const store = new UIStore();
  const pending = store.requestSelect({ title: 'Select', items: ['one', 'two'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.selectRequest.selected, 0);
  store.adjustSelect(1);
  assert.equal(store.selectRequest.selected, 1);
  store.cancelSelect();
  assert.equal(await pending, null);
  assert.equal(store.selectRequest, null);
});

test('typed modal input supports character deletion and confirmation', async () => {
  const store = new UIStore();
  const pending = store.requestInput({ title: 'Input' });
  await new Promise(resolve => setImmediate(resolve));
  store.appendInputChar('abc');
  store.appendInputChar('\x7f');
  store.appendInputChar('\r');
  assert.equal(await pending, 'ab');
  assert.equal(store.inputRequest, null);
});

test('conversation history undo and redo preserve messages', () => {
  const store = new UIStore();
  store.addItem({ type: 'user', text: 'hello' });
  store.addItem({ type: 'answer', text: 'world' });
  store.addConversationTurn('hello', 'world');
  const removed = store.undoConversationTurn();
  assert.equal(removed.user, 'hello');
  assert.equal(store.items.filter(item => item.type === 'answer').length, 0);
  store.redoConversationTurn();
  assert.equal(store.items.at(-1).text, 'world');
});


test('agent preparation is replaced by the completed status without duplicating event cards', () => {
  const store = new UIStore();
  store.addEvent('tool', 'Preparing spawn_agent', '');
  store.addEvent('ok', 'Completed spawn_agent', '{"agent_id":"a","role":"review","status":"running"}');
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].kind, 'ok');
  assert.match(store.items[0].title, /Completed spawn_agent/);
});
