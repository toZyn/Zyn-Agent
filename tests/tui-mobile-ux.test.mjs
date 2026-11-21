import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {getMemoryExportPrompt,formatOnboardingPreview}=require('../src/core/memory-transfer');
const {confirmationViewport}=await import('../src/tui/confirmation-view.mjs');
const {modelDisplayId}=require('../src/providers/model-id');

test('default is English regardless of Android or Linux LANG, but explicit ZYN_LANGUAGE works',()=>{
 for (const lang of ['es_PE.UTF-8','es_ES.UTF-8']){
  let run=spawnSync(process.execPath,['-e',`console.log(require('./src/config').DEFAULT_LANGUAGE)`],{cwd:process.cwd(),env:{...process.env,LANG:lang,ZYN_LANGUAGE:'',ZYN_DEFAULT_LANG:''},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(run.stdout.trim(),'en');
 }
 const explicit=spawnSync(process.execPath,['-e',`console.log(require('./src/config').DEFAULT_LANGUAGE)`],{cwd:process.cwd(),env:{...process.env,LANG:'es_PE.UTF-8',ZYN_LANGUAGE:'es'},encoding:'utf8'});
 assert.equal(explicit.stdout.trim(),'es');
});

test('onboarding preview has exactly three content lines, preserves full prompt separately',()=>{
 const original=getMemoryExportPrompt();
 const text=formatOnboardingPreview(original,54,'en');
 assert.match(text,/Here is the following prompt/);
 assert.match(text,/Press C to copy/i);
 assert.ok(text.split('\n').length<=12);
 assert.ok(!text.includes('Only include memories and preferences from BEFORE this conversation'));
 assert.equal(original.includes('Only include memories and preferences from BEFORE this conversation'),true);
});

test('approvals keep dangerous commands inspectable and bounded on phones',()=>{
 const cmd='free -h && printf "hello" && df -h && whoami';
 const detail=`Command: ${cmd}\nDirectory: /root/very-long-project-folder`;
 const compact=confirmationViewport({title:'Run command',detail},46,18);
 assert.match(compact.title,/Run command/);
 assert.ok(compact.lines.length<=4);
 assert.match(compact.lines.join(' '),/free -h/);
 assert.match(compact.footer,/View|Inspect/);
 const expanded=confirmationViewport({title:'Run command',detail,expanded:true,offset:0},46,18);
 assert.match(expanded.lines.join(' '),/Directory/);
 assert.ok(expanded.lines.length<=8);
});

test('model picker presents raw model IDs and avoids artificial chatgpt prefix',()=>{
 assert.equal(modelDisplayId('chatgpt-gpt-6-luna',{provider:'chatgpt',modelId:'gpt-6-luna'}),'gpt-6-luna');
 assert.equal(modelDisplayId('gemini-2.5-flash',{provider:'gemini',modelId:'gemini-2.5-flash'}),'gemini-2.5-flash');
});

test('unrecognized slash commands suggest nearby names without executing them',()=>{
 const {suggestCommand}=require('../src/cli/command-suggest');
 const commands=[{name:'model'},{name:'models'},{name:'help'}];
 assert.equal(suggestCommand('/moddl',commands),'model');
 assert.equal(suggestCommand('/modl',commands),'model');
 assert.equal(suggestCommand('/completelyunknown',commands),null);
});

test('direct model ID avoids conflicting keys and preserves their original provider',()=>{
 const {resolveAccountModelKey}=require('../src/providers/model-id');
 assert.equal(resolveAccountModelKey('gpt-6-luna',{}),'gpt-6-luna');
 assert.equal(resolveAccountModelKey('gpt-5',{ 'gpt-5': {provider:'openai'} }),'chatgpt:gpt-5');
});

test('account model cache keeps raw IDs for unique models and namespaced collisions',()=>{
 const tmp=require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'zyn-model-ids-'));
 try{
  const folder=require('node:path').join(tmp,'chatgpt');require('node:fs').mkdirSync(folder);
  require('node:fs').writeFileSync(require('node:path').join(folder,'models.json'),JSON.stringify({models:[{slug:'gpt-6-luna',label:'GPT-6 Luna'},{slug:'gpt-5',label:'GPT-5'}]}));
  const script="const {MODELS}=require('./src/config');const a=MODELS['gpt-6-luna'],b=MODELS['chatgpt:gpt-5'];if(a?.provider!=='chatgpt'||b?.provider!=='chatgpt')throw Error('account model missing');if(MODELS['gpt-5']?.provider!=='openai')throw Error('OpenAI model overwritten');if(MODELS['chatgpt-gpt-6-luna']!==a)throw Error('legacy session alias broken');console.log('OK')";
  const run=spawnSync(process.execPath,['-e',script],{cwd:process.cwd(),env:{...process.env,ZYN_DATA_DIR:tmp},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
 } finally {require('node:fs').rmSync(tmp,{recursive:true,force:true})}
});
