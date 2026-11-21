import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {SLASH_COMMANDS,handleLocalCommand}=require('../src/cli/commands');
const {MODELS}=require('../src/config');
function isolated(testFn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-commands-'));return Promise.resolve().then(()=>testFn(dir)).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));}
function getState(dir){return{cwd:dir,language:'es',sessionId:'test-local',history:[],actionLog:[],turnCount:0,settings:{},autoApprove:false,activeModel:'zyncloud-minimax-m3'};}
async function capture(action){const log=console.log,error=console.error;let parts=[];console.log=(...args)=>parts.push(args.join(' '));console.error=(...args)=>parts.push(args.join(' '));try{const result=await action();return{result,text:parts.join('\n')}}finally{console.log=log;console.error=error;}}

test('suggestion registry has unique commands and exposes essential agent actions',()=>{
 const names=SLASH_COMMANDS.map(item=>item.name);
 assert.equal(names.length,new Set(names).size);
 for(const name of ['help','model','models','login','logout','account','auth','context','stats','usage','version','clear','quit','sessions','resume','permissions','plan','doctor','skills','mcp','init','diff','tools','stop','undo','redo'])assert.ok(names.includes(name),`missing /${name}`);
 for(const entry of SLASH_COMMANDS)assert.ok(entry.desc && entry.descEs,`missing description /${entry.name}`);
});

test('help can explain specific commands rather than dumping unrelated output',()=>isolated(async(dir)=>{
 const state=getState(dir);
 const output=await capture(()=>handleLocalCommand('/help model',state,{}));
 assert.equal(output.result,true);
 assert.match(output.text,/\/model/);
 assert.match(output.text,/seleccion|choose|model/i);
 assert.ok(output.text.length<1500);
}));

test('model aliases show a useful picker fallback and reject unavailable model IDs',()=>isolated(async(dir)=>{
 const state=getState(dir);
 const first=await capture(()=>handleLocalCommand('/model',state,{}));
 assert.equal(first.result,true);
 assert.match(first.text,/models|modelo|model/i);
 await assert.rejects(handleLocalCommand('/model missing-model-abc',state,{}),/model|inválido|invalid/i);
 assert.ok(MODELS['zyncloud-minimax-m3']);
}));

test('login/account/logout explain how to use direct ChatGPT account authentication',()=>isolated(async(dir)=>{
 const state=getState(dir);
 const status=await capture(()=>handleLocalCommand('/account',state,{}));
 assert.equal(status.result,true);assert.match(status.text,/ChatGPT/i);
 const help=await capture(()=>handleLocalCommand('/login',state,{startChatGPTLogin:async()=>{throw new Error('test must not start OAuth without requested platform')}}));
 assert.equal(help.result,true);assert.match(help.text,/auth|login|ChatGPT/i);
 const wrong=await capture(()=>handleLocalCommand('/logout github',state,{}));
 assert.equal(wrong.result,true);assert.match(wrong.text,/github|gh auth/i);
}));

test('context and stats report actual session data as estimates, not fabricated billing',()=>isolated(async(dir)=>{
 const state=getState(dir);
 state.history=[{role:'user',content:'hello'},{role:'assistant',content:'world'}];state.turnCount=1;
 state.memorySummary='summary';state.importedMemory='context';
 const context=await capture(()=>handleLocalCommand('/context',state,{}));
 assert.equal(context.result,true);assert.match(context.text,/2/);assert.match(context.text,/estimate|estimad/i);
 const stats=await capture(()=>handleLocalCommand('/usage',state,{}));
 assert.equal(stats.result,true);assert.match(stats.text,/1/);assert.match(stats.text,/no.*factur|not.*bill|estimad/i);
}));

test('version and important non-interactive CLI entrypoints never enter the chat',()=>isolated(async(dir)=>{
 const expected=require('../package.json').version;
 for(const args of [['--version'],['version'],['help'],['models'],['auth','status'],['doctor']]){
  const result=spawnSync(process.execPath,['zyn.js',...args],{cwd:process.cwd(),env:{...process.env,ZYN_DATA_DIR:dir,ZYN_SKIP_ONBOARDING:'1'},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,`${args.join(' ')} ${result.stderr}`);
  assert.ok(result.stdout.trim(),`empty ${args.join(' ')}`);
  if(args[0]==='--version')assert.ok(result.stdout.includes(expected));
 }
}));
