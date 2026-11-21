import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {getCompactPrompt,buildSystemPrompt}=require('../src/core/prompts');

test('compaction prompt matches requested English task and eight-section schema',()=>{
  const prompt=getCompactPrompt('en');
  assert.ok(prompt.startsWith('Your task is to create a detailed summary of the conversation so far, paying close attention to the user\'s explicit requests and your previous actions.'));
  assert.match(prompt,/This summary should be thorough in capturing technical details, code patterns, and architectural decisions/);
  for(const section of ['Primary Request and Intent','Key Technical Concepts','Files and Code Sections','Problem Solving','Pending Tasks','Current Work','Optional Next Step'])assert.ok(prompt.includes(section),section);
  assert.match(prompt,/include direct quotes from the most recent conversation/);
  assert.match(prompt,/<analysis>/);
  assert.match(prompt,/<summary>/);
  assert.match(prompt,/Please provide your summary based on the conversation so far/);
});

test('explicit tool instructions take precedence over generic direct-answer heuristics',()=>{
  for(const language of ['es','en']){
    const prompt=buildSystemPrompt(process.cwd(),{language},{language,input:language==='es'?'Usa ask_user para hacerme una pregunta de matemáticas':'Use ask_user to ask me a math question'});
    assert.match(prompt,/ask_user/);
    assert.match(prompt,language==='es'?/si el usuario solicita explícitamente una herramienta/i:/when the user explicitly requests a tool/i);
    assert.doesNotMatch(prompt,language==='es'?/NO USES herramientas\. NO hagas tool calls/i:/DO NOT use tools\. DO NOT make tool calls/i);
  }
});
