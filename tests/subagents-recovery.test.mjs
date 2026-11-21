import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-agent-recovery-'));
process.env.ZYN_DATA_DIR=temp;
const require=createRequire(import.meta.url);
const { SubagentCoordinator }=require('../src/core/subagents');
const { defineAgent }=require('../src/core/agent-definitions');

const parent = (id) => ({
  sessionId:id,cwd:temp,activeModel:'test-model',language:'en',history:[],settings:{},autoApprove:true,
  tuiConfirm:async()=>false,
});
function manager(p,runTurn,extra={}) {
  return new SubagentCoordinator({parent:p,runTurn,dataRoot:temp,persist:true,autoResume:false,...extra});
}

test('running child is recoverable as interrupted after a process restart',async()=>{
  const p=parent('recover-parent');
  const old=manager(p,async()=>new Promise(()=>{}));
  const initial=old.spawn(p,{task:'Inspect RAM',role:'general'});
  assert.equal(initial.status,'running');
  assert.ok(fs.existsSync(path.join(temp,'chat','agent-runs','recover-parent.json')));
  const restored=manager(p,async(task,state)=>{
    assert.equal(state.autoApprove,false);
    return {content:'Done: '+task};
  });
  assert.equal(restored.lookup(initial.agent_id).status,'interrupted');
  const running=restored.resume(initial.agent_id);
  assert.equal(running.status,'running');
  const done=await restored.wait(initial.agent_id,1000);
  assert.equal(done.status,'completed');
  assert.match(done.result,/Inspect RAM/);
  assert.equal(restored.lookup(initial.agent_id).state.sessionPath.startsWith(path.join(temp,'chat','subagents')),true);
  assert.equal(p.history.length,0);
});

test('read-only agents auto-recover; writable agents stay interrupted until authorized',async()=>{
  const p=parent('auto-recover');
  const crash=manager(p,async()=>new Promise(()=>{}));
  const read=crash.spawn(p,{task:'Read docs',role:'explore'});
  const write=crash.spawn(p,{task:'Edit docs',role:'general'});
  const resumed= new SubagentCoordinator({
    parent:p,dataRoot:temp,persist:true,autoResume:true,
    runTurn:async(task,state)=>({content:state.__subagent.role+' '+task}),
  });
  assert.equal((await resumed.wait(read.agent_id,1000)).status,'completed');
  assert.equal(resumed.lookup(write.agent_id).status,'interrupted');
  assert.equal(resumed.lookup(write.agent_id).state.autoApprove,false);
});

test('reusable specialist definition grants instructions but not extra permissions',async()=>{
  const p=parent('custom-role');
  defineAgent({name:'storage-checker',role:'review',instructions:'Only report verified storage measurements.',allowedTools:['read_file']});
  let child;
  const run=manager(p,async(_task,state)=>{child=state;return {content:'checked'};});
  const task=run.spawn(p,{task:'Review free space',definition:'storage-checker'});
  const finished=await run.wait(task.agent_id,1000);
  assert.equal(finished.role,'review');
  assert.equal(finished.definition,'storage-checker');
  assert.match(child.__subagent.instructions,/verified storage/);
  assert.deepEqual(child.__subagent.allowedTools,['read_file']);
  assert.equal(child.autoApprove,false);
});

test('parent and peers exchange durable messages with separate mailboxes',async()=>{
  const p=parent('agent-messages');
  const run=manager(p,async()=>({content:'ready'}));
  const a=run.spawn(p,{task:'Explore A'}), b=run.spawn(p,{task:'Explore B'});
  await Promise.all([run.wait(a.agent_id,1000),run.wait(b.agent_id,1000)]);
  const msg=run.sendMessage(a.agent_id,'parent','Found a dependency');
  assert.equal(msg.delivered,true);
  run.sendMessage('parent',b.agent_id,'Review the dependency');
  run.sendMessage(a.agent_id,b.agent_id,'Cross-check version');
  const loaded=manager(p,async()=>({content:'continued'}));
  const parentInbox=loaded.readMessages('parent');
  assert.equal(parentInbox.length,1);
  assert.equal(parentInbox[0].from,a.agent_id);
  const peerInbox=loaded.readMessages(b.agent_id);
  assert.deepEqual(peerInbox.map(x=>x.content),['Review the dependency','Cross-check version']);
  assert.equal(loaded.readMessages(b.agent_id).length,0);
  assert.throws(()=>loaded.sendMessage('fake','parent','spoofed'),/Unknown sender/);
});

test('graceful exit still saves an interrupted task for resumption',async()=>{
  const p=parent('exit-recovery');
  const active=manager(p,async()=>new Promise(()=>{}));
  const task=active.spawn(p,{task:'Inspect repository',role:'general'});
  active.closeAll();
  const loaded=manager(p,async()=>({content:'retried'}));
  assert.equal(loaded.lookup(task.agent_id).status,'interrupted');
});

test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
