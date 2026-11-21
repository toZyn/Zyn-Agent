import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assertToolAllowed}=require('../src/core/tool-policy');
const {createProjectInstructions,readGitDiff,environmentReport,loginCommandSpec}=require('../src/cli/essentials');

test('plan mode enforces read-only actions centrally before invoking tools',()=>{
 const s={settings:{planMode:true}};
 for(const tool of ['read_file','list_dir','web_search','load_skill'])assert.doesNotThrow(()=>assertToolAllowed({tool,args:{}},s));
 for(const tool of ['run_command','write_file','make_dir','gmail','plugin_unsafe','mcp_remote_tool'])assert.throws(()=>assertToolAllowed({tool,args:{}},s),/plan|read-only/i);
 assert.doesNotThrow(()=>assertToolAllowed({tool:'git',args:{action:'api',method:'GET'}},s));
 assert.throws(()=>assertToolAllowed({tool:'git',args:{action:'api',method:'POST'}},s));
 assert.throws(()=>assertToolAllowed({tool:'memory',args:{action:'save',key:'test',value:'x'}},s));
 assert.doesNotThrow(()=>assertToolAllowed({tool:'memory',args:{action:'list'}},s));
 assert.doesNotThrow(()=>assertToolAllowed({tool:'run_command',args:{command:'echo hello'}},{settings:{planMode:false}}));
});
test('AGENTS.md initialization is non-destructive and respects explicit existing file',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-init-'));
 try {
  const created=await createProjectInstructions(tmp);assert.equal(created.created,true);
  assert.match(fs.readFileSync(path.join(tmp,'AGENTS.md'),'utf8'),/Verification/);
  const again=await createProjectInstructions(tmp);assert.equal(again.created,false);
 } finally {fs.rmSync(tmp,{recursive:true,force:true})}
});
test('diff reports the tracked work without invoking a shell',async()=>{
 const diff=await readGitDiff(process.cwd());
 assert.equal(typeof diff,'string');assert.ok(diff.length<70000);
});
test('login commands route only through official CLI with no private token export',()=>{
 assert.deepEqual(loginCommandSpec('github'),{command:'gh',args:['auth','login','--hostname','github.com','--web']});
 assert.throws(()=>loginCommandSpec('chatgpt'),/Unsupported/);
 assert.deepEqual(loginCommandSpec('gmail'),{command:'gws',args:['auth','login','-s','gmail']});
 assert.throws(()=>loginCommandSpec('unknown'));
});
test('doctor returns real environment details without secrets',async()=>{
 const report=await environmentReport({cwd:process.cwd(),autoApprove:false,settings:{planMode:true}});
 assert.match(report,/Node/);assert.match(report,/Plan.*ON/);assert.doesNotMatch(report,/password|access_token/i);
});

test('essential commands toggle enforceable planning and expose actual tools',async()=>{
 const {handleLocalCommand,SLASH_COMMANDS}=require('../src/cli/commands');
 const state={cwd:process.cwd(),language:'en',activeModel:'zyncloud-minimax-m3',autoApprove:false,settings:{}};
 const deps={};
 const original=console.log;const logs=[];console.log=(...a)=>logs.push(a.join(' '));
 try{
  assert.equal(await handleLocalCommand('/plan on',state,deps),true);
  assert.equal(state.settings.planMode,true);
  assert.throws(()=>assertToolAllowed({tool:'write_file',args:{path:'x'}},state),/read-only/);
  await handleLocalCommand('/permissions',state,deps);
  await handleLocalCommand('/tools',state,deps);
  assert.match(logs.join('\n'),/manual|approval/i);
  assert.match(logs.join('\n'),/read_file/);
  await handleLocalCommand('/plan off',state,deps);
  assert.equal(state.settings.planMode,false);
  assert.ok(SLASH_COMMANDS.some(x=>x.name==='doctor'));
 } finally {console.log=original;}
});
test('init confirms creation and will not replace an existing AGENTS.md',async()=>{
 const {handleLocalCommand}=require('../src/cli/commands');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-cli-init-'));
 const state={cwd:dir,language:'en',settings:{}};
 const original=console.log;console.log=()=>{};
 try{
  assert.equal(await handleLocalCommand('/init',state,{askConfirm:async()=>true}),true);
  assert.match(fs.readFileSync(path.join(dir,'AGENTS.md'),'utf8'),/Verification/);
  assert.equal(await handleLocalCommand('/init',state,{askConfirm:async()=>true}),true);
 } finally {console.log=original;fs.rmSync(dir,{recursive:true,force:true})}
});
