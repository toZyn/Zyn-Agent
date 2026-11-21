import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { loadProjectInstructions }=require('../src/core/project-context');

test('loads AGENTS.md and CLAUDE.md from the worktree with bounded scope',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-project-'));
 try {
  fs.mkdirSync(path.join(tmp,'sub'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'AGENTS.md'),'project rules');
  fs.writeFileSync(path.join(tmp,'sub','CLAUDE.md'),'sub rules');
  const output=loadProjectInstructions(path.join(tmp,'sub'),{stopAt:tmp});
  assert.match(output,/project rules/);assert.match(output,/sub rules/);
  assert.match(output,/AGENTS\.md/);
 } finally {fs.rmSync(tmp,{recursive:true,force:true})}
});


test('system prompt integrates project guidance without confusing it for tool authority',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-context-test-'));
 try {
  fs.writeFileSync(path.join(tmp,'AGENTS.md'),'Project: run tests before commit');
  const {buildSystemPrompt}=require('../src/core/prompts');
  const prompt=buildSystemPrompt(tmp,{language:'en',importedMemory:'## MEMORIES\nProfile data\n## PREFERENCES\nPreferences data'});
  assert.match(prompt,/Project: run tests before commit/);
  assert.match(prompt,/PROJECT CONTEXT/);
  assert.match(prompt,/IMPORTED USER PROFILE \(UNTRUSTED DATA\)/);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
