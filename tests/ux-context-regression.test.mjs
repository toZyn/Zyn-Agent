import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MODELS,getContextLimit,DEFAULT_SETTINGS} = require('../src/config');
const {buildToolResultMessage} = require('../src/core/prompts');
const {truncateText} = require('../src/utils/text');
const {UIStore} = await import('../src/tui/store.mjs');

test('unknown ChatGPT context is unknown, not an invented 128K',()=>{
  assert.equal(getContextLimit('chatgpt-account'),0);
  assert.equal(getContextLimit('model-not-discovered'),0);
});

test('live model metadata uses actual provider-reported context window', async()=>{
  const {fetchAvailableChatGPTModels,refreshChatGPTCatalog}=require('../src/providers/chatgpt');
  const mock={models:[{slug:'model-window',display_name:'Window',visibility:'list',context_window:262144},{slug:'model-missing',display_name:'Unknown',visibility:'list'}]};
  const fetcher=async()=>new Response(JSON.stringify(mock),{status:200});
  const models=await fetchAvailableChatGPTModels({getAccessToken:async()=> 'demo',fetcher});
  assert.equal(models[0].contextLength,262144);
  assert.equal(models[1].contextLength,undefined);
  await refreshChatGPTCatalog({getAccessToken:async()=> 'demo',fetcher});
  assert.equal(getContextLimit('model-window'),262144);
  assert.equal(getContextLimit('model-missing'),0);
});

test('actual usage is displayed separately from estimated context and updates per turn',()=>{
  const store=new UIStore();
  store.setTokenEstimate(123,262144);
  store.setTokenUsage({promptTokens:412,completionTokens:27,totalTokens:439});
  assert.equal(store.tokenEstimate,123);
  assert.equal(store.lastMeasuredTokens,439);
  assert.equal(store.contextLimit,262144);
  store.setTokenUsage({promptTokens:30,completionTokens:5,totalTokens:35});
  assert.equal(store.lastMeasuredTokens,35);
});

test('tool results are not discarded by a 50k-character arbitrary limit',()=>{
  const output='A'.repeat(70000)+'END_OF_RESULT';
  assert.ok(truncateText(output).endsWith('END_OF_RESULT'));
  const wrapped=buildToolResultMessage({tool:'read_file',args:{path:'some.txt'}},output,'en');
  assert.ok(wrapped.includes('END_OF_RESULT'));
  assert.ok(!wrapped.includes('[truncated result'));
});

test('tool loop has no arbitrary default step count, and explicit caps still work',()=>{
  const {isToolStepLimitReached}=require('../src/core/tool-budget');
  assert.equal(DEFAULT_SETTINGS.maxToolSteps,0);
  assert.equal(isToolStepLimitReached(500,0),false);
  assert.equal(isToolStepLimitReached(500,10),true);
});

test('/account is a consolidated dashboard, not a ChatGPT-only alias',async()=>{
 const {handleLocalCommand}=require('../src/cli/commands');
 const state={activeModel:'gpt-4o',language:'en',history:[],settings:{},cwd:process.cwd()};
 const result=[];const orig=console.log;console.log=(...parts)=>result.push(parts.join(' '));
 try {assert.equal(await handleLocalCommand('/account',state,{}),true);} finally {console.log=orig;}
 const content=result.join('\n');
 for(const provider of ['GitHub','ChatGPT','Gmail'])assert.match(content,new RegExp(provider,'i'));
 assert.match(content,/gpt-4o/);
});

test('original conversation content is not destructively removed by a 200k-character default',()=>{
 const {truncateHistory}=require('../src/core/prompts');
 const state={history:Array.from({length:80},(_,i)=>({role:'user',content:String(i).padStart(3,'0')+'x'.repeat(4000)})),settings:{}};
 truncateHistory(state);
 assert.equal(state.history[0].content.length,4003);
 assert.equal(state.history.length,80);
});

test('terminal output preview is bounded, while original content remains intact',async()=>{
 const {formatEventPreview}=await import('../src/tui/event-display.mjs');
 const original='Exit code: 0\nSTDOUT: '+('0123456789'.repeat(120));
 const item={kind:'ok',title:'Command completed',detail:original};
 const preview=formatEventPreview(item,52);
 assert.ok(preview.lines.length<=2);
 assert.ok(preview.lines.every(line=>line.length<=42));
 assert.match(preview.hint,/transcript/i);
 assert.equal(item.detail,original);
});

test('context approximation counts imported and persona memory',()=>{
 const {estimateContextTokens}=require('../src/config');
 const state={history:[],importedMemory:'x'.repeat(4000),personaPrompt:'y'.repeat(4000),memorySummary:''};
 assert.ok(estimateContextTokens(state)>=2000);
});

test('session metrics explicitly distinguish measured provider usage from estimated context',()=>{
 const {formatSessionMetrics}=require('../src/cli/session-metrics');
 const state={activeModel:'chatgpt-account',language:'en',history:[],lastTokenUsage:{promptTokens:180,completionTokens:20,totalTokens:200}};
 const report=formatSessionMetrics(state,{contextOnly:true});
 assert.match(report,/200/);
 assert.match(report,/measured/i);
 assert.match(report,/unavailable/i);
});

test('ChatGPT response.completed exposes actual provider usage, not synthetic estimates',async()=>{
 const {runChatGPTResponses}=require('../src/providers/chatgpt');
 const chunk='data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:313,output_tokens:47,total_tokens:360}}})+'\n\n';
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(chunk));c.close()}});
 const result=await runChatGPTResponses([{role:'user',content:'Hi'}],'model',()=>{},{getAccessToken:async()=> 'test',fetcher:async()=>new Response(stream)});
 assert.deepEqual(result.usage,{promptTokens:313,completionTokens:47,totalTokens:360});
});

test('model receives complete tool arguments even for long commands',()=>{
 const {sanitizeArgsForModel}=require('../src/core/prompts');
 const command='printf x'.repeat(1000);
 assert.equal(sanitizeArgsForModel({args:{command}}).command,command);
});

test('default 0 limits are configurable in slash settings',()=>{
 const {DEFAULT_SETTINGS}=require('../src/config');
 assert.equal(DEFAULT_SETTINGS.maxHistoryChars,0);
 assert.equal(DEFAULT_SETTINGS.maxOutputChars,0);
});

test('unlimited steps still detect identical no-progress tool calls without limiting productive calls',()=>{
 const {ToolProgressGuard}=require('../src/core/tool-budget');
 const guard=new ToolProgressGuard(6);
 for(let i=0;i<40;i++){
  assert.equal(guard.observe({tool:'read_file',args:{path:'demo'}},`changed-${i}`),false);
 }
 for(let i=0;i<5;i++) assert.equal(guard.observe({tool:'read_file',args:{path:'demo'}},'same'),false);
 assert.equal(guard.observe({tool:'read_file',args:{path:'demo'}},'same'),true);
 assert.equal(guard.observe({tool:'read_file',args:{path:'other'}},'same'),false);
});
