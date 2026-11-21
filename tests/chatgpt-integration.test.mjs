import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chat}=require('../src/providers/scraperClient');

test('Zyn agent executes an account-backed model without Codex CLI, API key, or static model name',async()=>{
 const requests=[];
 const received=[];
 const response=await chat({modelKey:'chatgpt-account',messages:[{role:'system',content:'Use JSON protocol'}, {role:'user',content:'Hi'}],onChunk:(delta)=>received.push(delta)}, {
  getAccessToken:async()=> 'test-authorized-oauth-token',
  fetcher:async(url,opts)=>{
   requests.push({url,opts});
   if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'account-model',display_name:'Account model',visibility:'list'}]}),{status:200});
   return new Response('data: {"type":"response.output_text.delta","delta":"{\\"type\\":\\"final\\",\\"content\\":\\"Hello\\"}"}\n\ndata: {"type":"response.completed"}\n\n',{status:200});
  },
 });
 assert.equal(requests.length,2);
 assert.equal(requests[0].url,'https://api.openai.com/v1/models');
 assert.equal(requests[1].url,'https://api.openai.com/v1/responses');
 assert.equal(JSON.parse(requests[1].opts.body).model,'account-model');
 assert.match(response.answer,/Hello/);
 assert.match(received.join(''),/Hello/);
});

test('ChatGPT status is available through Zyn CLI even when Codex is absent',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-cli-auth-'));
 try {
  const result=spawnSync(process.execPath,['zyn.js','auth','chatgpt','status'],{cwd:process.cwd(),env:{...process.env,ZYN_DATA_DIR:directory,PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:8000});
  assert.equal(result.status,0,result.stderr);
  const status=JSON.parse(result.stdout);
  assert.deepEqual(status,{connected:false,sharing:false});
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
