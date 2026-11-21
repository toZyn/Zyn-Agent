import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {copyToClipboard}=require('../src/core/clipboard');
test('Android Termux clipboard uses local API when available and never prints prompt',()=>{
 const prompt='Full private prompt text';
 const calls=[];
 const output={isTTY:true,write:()=>{throw Error('Should not write to terminal')}};
 const result=copyToClipboard(prompt,{platform:'linux',env:{PREFIX:'/data/data/com.termux/files/usr'},output,run:(cmd,args,opts)=>{calls.push({cmd,body:opts.input});return {status:0}}});
 assert.equal(result.verified,true);assert.equal(result.method,'termux-clipboard-set');
 assert.equal(calls[0].body,prompt);
});
test('OSC52 fallback sends encoded prompt only and explicitly marks unsupported clipboard as unverified',()=>{
 const data=[];
 const result=copyToClipboard('abc+def',{platform:'linux',env:{},run:()=>({status:1}),output:{isTTY:true,write:chunk=>data.push(chunk)}});
 assert.equal(result.verified,false);assert.equal(result.method,'OSC52');
 assert.equal(data.join('').startsWith('\x1b]52;c;'),true);
 assert.ok(!data.join('').includes('abc+def'));
});
test('noninteractive clipboard failure does not disclose whole prompt',()=>{
 const data=[];
 const result=copyToClipboard('private',{platform:'linux',env:{},run:()=>({status:1}),output:{isTTY:false,write:chunk=>data.push(chunk)}});
 assert.equal(result.method,null);assert.equal(data.length,0);
});

test('memory prompt in CLI is compact by default and explicit --show reveals full text',()=>{
 const {spawnSync}=require('node:child_process');
 const compact=spawnSync(process.execPath,['zyn.js','memory','prompt'],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{...process.env,TERM:'dumb'}});
 assert.equal(compact.status,0,compact.stderr);
 assert.match(compact.stdout,/Here is the following prompt/);
 assert.doesNotMatch(compact.stdout,/Only include memories and preferences from BEFORE/);
 const explicit=spawnSync(process.execPath,['zyn.js','memory','prompt','--show'],{cwd:process.cwd(),encoding:'utf8',timeout:10000});
 assert.equal(explicit.status,0,explicit.stderr);
 assert.match(explicit.stdout,/Only include memories and preferences from BEFORE/);
});
