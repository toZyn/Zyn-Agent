import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SubagentCoordinator, ROLES, quietUI } = require('../src/core/subagents');
const { assertToolAllowed } = require('../src/core/tool-policy');

function parent(sessionId = 'parent-test') {
  return {
    sessionId, cwd: process.cwd(), activeModel: 'test-model',
    language: 'en', history: [{ role: 'user', content: 'PARENT_HISTORY' }],
    importedMemory: 'PARENT_MEMORY', memorySummary: 'PARENT_SUMMARY',
    settings: { planMode: false }, theme: 'dark', autoApprove: true,
    tuiConfirm: async () => false,
  };
}
const settle = promise => new Promise(resolve => setImmediate(resolve)).then(() => promise);

test('subagents use separate session IDs and do not copy context by default', async () => {
  let childState;
  const manager = new SubagentCoordinator({ runTurn: async (_task, state) => {
    childState = state;
    return { content: 'reviewed' };
  } });
  const p = parent();
  const started = manager.spawn(p, { task: 'Review module' });
  const completed = await manager.wait(started.agent_id, 1000);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result, 'reviewed');
  assert.equal(childState.history.length, 0);
  assert.equal(childState.importedMemory, '');
  assert.notEqual(childState.sessionId, p.sessionId);
  assert.equal(childState.autoApprove, false);
  assert.equal(p.history[0].content, 'PARENT_HISTORY');
  assert.equal(p.autoApprove, true);
});

test('explicit all-fork copies data without sharing references', async () => {
  const p = parent();
  let state;
  const manager = new SubagentCoordinator({ runTurn: async (_task, child) => {
    state = child;
    child.history[0].content = 'CHANGED_CHILD';
    return { content: 'okay' };
  } });
  const job = manager.spawn(p, { task: 'Use context', role: 'review', fork: 'all' });
  await manager.wait(job.agent_id, 1000);
  assert.equal(state.importedMemory, 'PARENT_MEMORY');
  assert.equal(p.history[0].content, 'PARENT_HISTORY');
});

test('subagents preserve parent approval and never gain auto-approval', async () => {
  let child;
  const manager = new SubagentCoordinator({ runTurn: async (_, state) => {
    child = state;
    return { content: 'done' };
  } });
  const job = manager.spawn(parent(), { task: 'Fix a file', role: 'general' });
  await manager.wait(job.agent_id, 1000);
  assert.equal(child.autoApprove, false);
  assert.equal(await child.tuiConfirm('Overwrite file', 'test'), false);
  assert.equal(child.settings.planMode, false);
});

test('read-only roles cannot write or spawn nested agents', async () => {
  let state;
  const manager = new SubagentCoordinator({ runTurn: async (_, child) => {
    state = child; return { content: 'done' };
  } });
  const job = manager.spawn(parent(), { task: 'Explore' });
  await manager.wait(job.agent_id, 1000);
  assert.doesNotThrow(() => assertToolAllowed({ tool: 'read_file', args: { path: 'README.md' } }, state));
  assert.throws(() => assertToolAllowed({ tool: 'write_file', args: { path: 'a' } }, state), /does not allow|Read-only/);
  assert.throws(() => assertToolAllowed({ tool: 'spawn_agent', args: { task: 'nested' } }, state), /cannot control/);
  assert.throws(() => manager.spawn(state, { task: 'nested' }), /cannot spawn/);
});

test('concurrency is bounded and completed agents release capacity', async () => {
  const gates = [];
  const manager = new SubagentCoordinator({ maxActive: 2, runTurn: async () => new Promise(resolve => gates.push(resolve)) });
  const p = parent();
  const first = manager.spawn(p, { task: 'First' });
  const second = manager.spawn(p, { task: 'Second' });
  assert.throws(() => manager.spawn(p, { task: 'Third' }), /limit reached/);
  await settle(Promise.resolve());
  gates[0]({ content: 'first done' });
  assert.equal((await manager.wait(first.agent_id, 1000)).status, 'completed');
  const third = manager.spawn(p, { task: 'Third' });
  await settle(Promise.resolve());
  gates[1]({ content: 'second done' });
  gates[2]({ content: 'third done' });
  assert.equal((await manager.wait(second.agent_id, 1000)).status, 'completed');
  assert.equal((await manager.wait(third.agent_id, 1000)).status, 'completed');
});

test('wait returns running status on timeout and followup retains independent history', async () => {
  let proceed;
  const calls = [];
  const manager = new SubagentCoordinator({ runTurn: async (task, state) => {
    calls.push(task);
    if (task === 'slow') await new Promise(resolve => { proceed = resolve; });
    state.history.push({ role: 'assistant', content: task });
    return { content: 'finished:' + task };
  } });
  const job = manager.spawn(parent(), { task: 'slow' });
  await settle(Promise.resolve());
  assert.equal((await manager.wait(job.agent_id, 5)).status, 'running');
  proceed();
  assert.equal((await manager.wait(job.agent_id, 1000)).status, 'completed');
  const followup = await manager.followup(job.agent_id, 'continue');
  assert.equal(followup.status, 'running');
  const final = await manager.wait(job.agent_id, 1000);
  assert.equal(final.result, 'finished:continue');
  assert.deepEqual(calls, ['slow', 'continue']);
});

test('interrupt signals an active child and closes it without affecting its parent', async () => {
  let startedSignal;
  const manager = new SubagentCoordinator({ runTurn: async (_, state, ui, options) => {
    startedSignal = options.signal;
    await new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  } });
  const p = parent();
  const job = manager.spawn(p, { task: 'Slow task' });
  await settle(Promise.resolve());
  manager.interrupt(job.agent_id);
  assert.equal(startedSignal.aborted, true);
  const stopped = await manager.wait(job.agent_id, 1000);
  assert.equal(stopped.status, 'cancelled');
  assert.equal(p.history.length, 1);
  assert.deepEqual(manager.close(job.agent_id), { agent_id: job.agent_id, closed: true });
  assert.equal(manager.list().length, 0);
});

test('role definitions, validation, and UI bindings are well-formed', () => {
  assert.deepEqual(Object.keys(ROLES), ['explore', 'review', 'plan', 'general']);
  const ui = quietUI();
  for (const name of ['pushAction', 'logEvent', 'startThinkingIndicator', 'beginAssistantStream', 'endAssistantStream']) {
    assert.equal(typeof ui[name], 'function');
  }
  const manager = new SubagentCoordinator();
  assert.throws(() => manager.spawn(parent(), { task: '' }), /Task must/);
  assert.throws(() => manager.spawn(parent(), { task: 'x', role: 'made-up' }), /Unknown subagent role/);
});


test('general child cannot perform account or plugin actions without the parent', async () => {
  let child;
  const manager = new SubagentCoordinator({ runTurn: async (_, state) => {
    child = state;
    return { content: 'ready' };
  } });
  const job = manager.spawn(parent(), { task: 'Inspect code', role: 'general' });
  await manager.wait(job.agent_id, 1000);
  assert.doesNotThrow(() => assertToolAllowed({ tool: 'read_file', args: { path: 'README.md' } }, child));
  assert.doesNotThrow(() => assertToolAllowed({ tool: 'write_file', args: { path: 'README.md' } }, child));
  assert.throws(() => assertToolAllowed({ tool: 'gmail', args: { action: 'send' } }, child), /cannot invoke/);
  assert.throws(() => assertToolAllowed({ tool: 'git', args: { action: 'api', method: 'POST' } }, child), /must be completed/);
  assert.throws(() => assertToolAllowed({ tool: 'mcp_external_write', args: {} }, child), /cannot invoke/);
  assert.throws(() => assertToolAllowed({ tool: 'fetch', args: { method: 'POST' } }, child), /must be completed/);
});


test('a cancelling subagent cannot start a second turn until the first promise settles',async()=>{
  let release;
  let turns=0;
  const manager=new SubagentCoordinator({runTurn:async()=>{
    turns++;
    if(turns===1) await new Promise(resolve=>{release=resolve;});
    return {content:'finished'};
  }});
  const worker=manager.spawn(parent('cancel-test'),{task:'check'});
  await new Promise(resolve=>setImmediate(resolve));
  manager.interrupt(worker.agent_id);
  assert.throws(()=>manager.resume(worker.agent_id),/still running or cancelling/);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  const continued=manager.resume(worker.agent_id);
  assert.equal(continued.status,'running');
  assert.equal((await manager.wait(worker.agent_id,1000)).status,'completed');
});

test('mailbox does not silently drop older messages when many arrive',()=>{
  const manager=new SubagentCoordinator();
  for(let i=0;i<140;i++) manager.sendMessage('parent','parent','Note '+i);
  const messages=manager.readMessages('parent');
  assert.equal(messages.length,140);
  assert.equal(messages[0].content,'Note 0');
  assert.equal(messages.at(-1).content,'Note 139');
});
