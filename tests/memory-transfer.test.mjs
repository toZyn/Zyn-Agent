import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { parseImportedMemory, getMemoryExportPrompt, saveImportedProfile, readImportedProfile, clearImportedProfile, markMemoryOnboarding, hasSeenMemoryOnboarding } = require('../src/core/memory-transfer');

const SAMPLE = '```markdown\n## MEMORIES\n### Personal Context\n1. Peru\n## PREFERENCES\n### Tone\n1. Clear\n```';
test('export prompt preserves requested structure and rules', () => {
  const prompt = getMemoryExportPrompt();
  assert.match(prompt, /Export everything you know/);
  assert.match(prompt, /### Work Context/);
  assert.match(prompt, /### Task Behavior/);
  assert.match(prompt, /Only include memories and preferences from BEFORE this conversation/);
});
test('import removes only outer code fence, preserving the section text', () => {
  assert.equal(parseImportedMemory(SAMPLE), '## MEMORIES\n### Personal Context\n1. Peru\n## PREFERENCES\n### Tone\n1. Clear');
  assert.throws(() => parseImportedMemory('Not the specified export'), /MEMORIES/);
});
test('an optional import is saved privately and can be deleted', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'zyn-mem-test-'));
  const file = path.join(temp,'import.md');
  const flag = path.join(temp,'onboarding.json');
  try {
    assert.equal(await hasSeenMemoryOnboarding(flag),false);
    await saveImportedProfile(SAMPLE,file);
    assert.equal((await readImportedProfile(file)).includes('Personal Context'),true);
    assert.equal(fs.statSync(file).mode & 0o077,0);
    await markMemoryOnboarding(flag);
    assert.equal(await hasSeenMemoryOnboarding(flag),true);
    await clearImportedProfile(file);
    assert.equal(await readImportedProfile(file),'');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('imported memory follows new and resumed sessions and can be forgotten everywhere', () => {
  const {spawnSync}=require('node:child_process');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-memory-session-'));
  try {
    const script=`
      (async()=>{
        const {saveImportedProfile, readImportedProfile}=require('./src/core/memory-transfer');
        const {createNewSessionState,loadSessionState,forgetImportedMemoryEverywhere}=require('./src/utils/sessionStorage');
        const {buildSystemPrompt}=require('./src/core/prompts');
        const input='## MEMORIES\\n### Personal Context\\n1. From Mars\\n## PREFERENCES\\n### Tone\\n1. Concise';
        await saveImportedProfile(input);
        const a=await createNewSessionState(null);
        if(!a.importedMemory.includes('From Mars'))throw Error('missing new session snapshot');
        if(!buildSystemPrompt(a.cwd,a).includes('From Mars'))throw Error('missing provider context');
        const b=await loadSessionState(a.sessionId,null);
        if(b.importedMemory!==a.importedMemory)throw Error('resume snapshot mismatch');
        await forgetImportedMemoryEverywhere();
        if(await readImportedProfile())throw Error('global memory not removed');
        const c=await loadSessionState(a.sessionId,null);
        if(c.importedMemory)throw Error('session memory not removed');
      })().catch(e=>{console.error(e.stack);process.exit(1)})
    `;
    const out=spawnSync(process.execPath,['-e',script],{cwd:process.cwd(),env:{...process.env,ZYN_DATA_DIR:tmp},encoding:'utf8',timeout:15000});
    assert.equal(out.status,0,out.stderr);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
