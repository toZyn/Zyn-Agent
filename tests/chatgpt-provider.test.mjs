import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const { fetchAvailableChatGPTModels, runChatGPTResponses, refreshChatGPTCatalog }=require('../src/providers/chatgpt/index');

test('model discovery uses OAuth Bearer and only displays models authorized for the account',async()=>{
 let observed;
 const models=await fetchAvailableChatGPTModels({getAccessToken:async()=> 'oauth-token',fetcher:async(url,opts)=>{observed={url,opts};return new Response(JSON.stringify({models:[{slug:'gpt-6.1-sol',display_name:'GPT 6.1 Sol',visibility:'list'},{slug:'private-hidden',display_name:'Hidden',visibility:'hidden'}]}),{status:200})}});
 assert.equal(observed.url,'https://api.openai.com/v1/models');
 assert.equal(observed.opts.headers.Authorization,'Bearer oauth-token');
 assert.deepEqual(models,[{slug:'gpt-6.1-sol',label:'GPT 6.1 Sol'}]);
});

test('Responses API sends supported fields with system context in instructions and streams deltas',async()=>{
 let requestBody,requestAuth;
 const encoder=new TextEncoder();
 const stream=new ReadableStream({start(controller){
  controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"He'));
  controller.enqueue(encoder.encode('llo"}\n\ndata: {"type":"response.output_text.delta","delta":" world"}\n\n'));
  controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
  controller.close();
 }});
 const received=[];
 const fetcher=async(url,opts)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');requestBody=JSON.parse(opts.body);requestAuth=opts.headers.Authorization;
   return new Response(stream,{status:200});
 };
 const result=await runChatGPTResponses([
  {role:'system',content:'Behave as a coding agent'},
  {role:'user',content:'Hi'},
  {role:'assistant',content:'Ready'},
  {role:'user',content:'Go'},
 ],'gpt-6.1-sol',(chunk,phase)=>received.push([chunk,phase]),{getAccessToken:async()=> 'oauth-token',fetcher});
 assert.equal(requestAuth,'Bearer oauth-token');
 assert.equal(requestBody.store,false);
 assert.equal(requestBody.stream,true);
 assert.equal(requestBody.model,'gpt-6.1-sol');
 assert.equal(requestBody.instructions,'Behave as a coding agent');
 assert.equal(requestBody.input.length,3);
 assert.ok(!requestBody.input.some(x=>x.role==='system'));
 assert.equal(result.text,'Hello world');
 assert.equal(received.map(x=>x[0]).join(''),'Hello world');
});

test('stream rejects missing completion and failed responses rather than giving false success',async()=>{
 const reply=body=>async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close()}}),{status:200});
 await assert.rejects(runChatGPTResponses([{role:'user',content:'Hi'}],'demo',()=>{},{getAccessToken:async()=> 'a',fetcher:reply('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')}),/completion|completed/i);
 await assert.rejects(runChatGPTResponses([{role:'user',content:'Hi'}],'demo',()=>{},{getAccessToken:async()=> 'a',fetcher:reply('data: {"type":"response.failed","response":{"error":{"message":"quota exceeded"}}}\n\n')}),/quota exceeded/);
});

test('sync catalogs are based on the account and never expose hidden models',async()=>{
 const {MODELS}=require('../src/config');
 const result=await refreshChatGPTCatalog({getAccessToken:async()=> 'demo',fetcher:async()=>new Response(JSON.stringify({models:[{slug:'model-special',display_name:'Special model',visibility:'list'}]}),{status:200})});
 assert.equal(result.length,1);
 assert.equal(MODELS['model-special'].modelId,'model-special');
 assert.equal(MODELS['chatgpt-model-special'].modelId,'model-special');
 assert.equal(Object.keys(MODELS).includes('chatgpt-model-special'),false);
});

test('refresh removes stale hidden legacy aliases and registers updated account IDs',async()=>{
 const {MODELS}=require('../src/config');
 const network=async()=>new Response(JSON.stringify({models:[{slug:'new-account-model',display_name:'New Model',visibility:'list'}]}),{status:200});
 await refreshChatGPTCatalog({getAccessToken:async()=> 'test',fetcher:network});
 assert.equal(MODELS['model-special'],undefined);
 assert.equal(MODELS['chatgpt-model-special'],undefined);
 assert.equal(MODELS['new-account-model'].provider,'chatgpt');
 assert.equal(Object.keys(MODELS).includes('chatgpt-new-account-model'),false);
});
