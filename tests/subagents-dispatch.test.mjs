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


test('worker messages are delivered through the registered tool dispatcher',async()=>{
  const session={...parent,sessionId:'worker-mailbox-test'};
  const coordinator=getCoordinator(session);
  coordinator.runTurn=async(task,child)=>{
    const sent=JSON.parse(await executeToolCall({
      tool:'send_agent_message',args:{agent_id:'parent',message:'Review completed: '+task},
    },child,ui));
    assert.equal(sent.delivered,true);
    return {content:'done'};
  };
  try{
    const child=JSON.parse(await executeToolCall({
      tool:'spawn_agent',args:{role:'review',task:'Inspect tests'},
    },session,ui));
    assert.equal((await coordinator.wait(child.agent_id,2000)).status,'completed');
    const mailbox=JSON.parse(await executeToolCall({tool:'read_agent_messages',args:{}},session,ui));
    assert.equal(mailbox.length,1);
    assert.equal(mailbox[0].from,child.agent_id);
    assert.match(mailbox[0].content,/Review completed/);
    assert.deepEqual(JSON.parse(await executeToolCall({tool:'read_agent_messages',args:{}},session,ui)),[]);
    const sent=JSON.parse(await executeToolCall({
      tool:'send_agent_message',args:{agent_id:child.agent_id,message:'Please verify again'},
    },session,ui));
    assert.equal(sent.delivered,true);
    assert.deepEqual(coordinator.lookup(child.agent_id).state.getQueuedMessages(),['Message from parent: Please verify again']);
  }finally{closeCoordinators();}
});


test('agent lifecycle events emit parseable short status data rather than truncated JSON',async()=>{
  const session={...parent,sessionId:'agent-status-event-test'};
  const coordinator=getCoordinator(session);
  coordinator.runTurn=async()=>({content:'done'});
  const events=[];
  const display={paint:x=>String(x),logEvent:(_,kind,title,detail)=>events.push({kind,title,detail})};
  try{
    const started=JSON.parse(await executeToolCall({tool:'spawn_agent',args:{task:'Inspect'}},session,display));
    await executeToolCall({tool:'wait_agent',args:{agent_id:started.agent_id,timeout_ms:1000}},session,display);
    const startEvent=events.find(x=>x.title.includes('spawn_agent'));
    const waitEvent=events.find(x=>x.title.includes('wait_agent'));
    for(const e of [startEvent,waitEvent]){
      assert.ok(e);
      const details=JSON.parse(e.detail);
      assert.equal(details.agent_id,started.agent_id);
      assert.equal(details.role,'explore');
      assert.ok(['running','completed'].includes(details.status));
      assert.equal(details.task,undefined);
    }
  }finally{closeCoordinators();}
});
