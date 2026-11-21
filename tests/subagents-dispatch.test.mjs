import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { executeToolCall } = require('../src/tools');
const { getCoordinator, closeCoordinators } = require('../src/core/subagents');
const ui = { paint: value => String(value), logEvent: () => {} };
const parent = {
  sessionId: 'subagent-dispatch-fixture',
  activeModel: 'mock-provider-model',
  cwd: process.cwd(),
  language: 'en',
  history: [],
  settings: {},
  autoApprove: false,
};

test('tool dispatcher spawns, waits, lists, follows up and closes real child coordinator', async () => {
  const coordinator = getCoordinator(parent);
  const received = [];
  coordinator.runTurn = async (task, child) => {
    received.push({ task, sessionId: child.sessionId, history: child.history.length });
    child.history.push({ role: 'user', content: task });
    return { content: 'result: ' + task };
  };
  try {
    const started = JSON.parse(await executeToolCall({
      tool: 'spawn_agent', args: { task: 'Inspect the codebase', role: 'review', fork: 'none' },
    }, parent, ui));
    assert.equal(started.role, 'review');
    assert.equal(started.status, 'running');
    const awaited = JSON.parse(await executeToolCall({
      tool: 'wait_agent', args: { agent_id: started.agent_id, timeout_ms: 2000 },
    }, parent, ui));
    assert.equal(awaited.status, 'completed');
    assert.equal(awaited.result, 'result: Inspect the codebase');

    const listing = JSON.parse(await executeToolCall({ tool: 'list_agents', args: {} }, parent, ui));
    assert.equal(listing.length, 1);
    assert.equal(listing[0].agent_id, started.agent_id);

    const followup = JSON.parse(await executeToolCall({
      tool: 'followup_agent', args: { agent_id: started.agent_id, task: 'Check tests' },
    }, parent, ui));
    assert.equal(followup.status, 'running');
    const second = JSON.parse(await executeToolCall({
      tool: 'wait_agent', args: { agent_id: started.agent_id, timeout_ms: 2000 },
    }, parent, ui));
    assert.equal(second.result, 'result: Check tests');
    assert.equal(received[0].history, 0);
    assert.equal(received[1].history, 1);
    assert.equal(received[0].sessionId, received[1].sessionId);

    const closed = JSON.parse(await executeToolCall({
      tool: 'close_agent', args: { agent_id: started.agent_id },
    }, parent, ui));
    assert.equal(closed.closed, true);
    assert.equal(coordinator.list().length, 0);
  } finally {
    closeCoordinators();
  }
});
