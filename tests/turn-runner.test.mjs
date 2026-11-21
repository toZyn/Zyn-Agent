import test from 'node:test';
import assert from 'node:assert/strict';
import { runSerialInputs } from '../src/tui/turn-runner.mjs';

function makeStore() {
  return {
    processing: false,
    pendingExit: false,
    messageQueue: [],
    events: [],
    _emit() {},
    enqueueMessage(input) { this.messageQueue.push(input); },
  };
}

test('simultaneous commands run sequentially', async () => {
  const store = makeStore();
  const order = [];
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const execute = async input => {
    order.push('start ' + input);
    if (input === 'first') await paused;
    order.push('end ' + input);
  };
  const task1 = runSerialInputs({ store, firstInput: 'first', execute, onError: () => {} });
  const task2 = runSerialInputs({ store, firstInput: '/help', execute, onError: () => {} });
  release();
  await Promise.all([task1, task2]);
  assert.deepEqual(order, ['start first', 'end first', 'start /help', 'end /help']);
  assert.equal(store.processing, false);
});

test('failed command cannot wedge the processing state', async () => {
  const store = makeStore();
  const seen = [];
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const execute = async input => {
    if (input === 'failed') { await paused; throw new Error('bad command'); }
    seen.push(input);
  };
  const a = runSerialInputs({store, firstInput:'failed', execute, onError: error => seen.push(error.message)});
  const b = runSerialInputs({store, firstInput:'after', execute, onError: () => {}});
  release(); await Promise.all([a, b]);
  assert.deepEqual(seen, ['bad command', 'after']);
  assert.equal(store.processing, false);
});

test('pending exit prevents queued commands running', async () => {
  const store = makeStore();
  store.messageQueue.push('do not run');
  const seen = [];
  await runSerialInputs({store,firstInput:'exit',execute:async text=>{seen.push(text);store.pendingExit=true},onError:()=>{}});
  assert.deepEqual(seen,['exit']);
});
