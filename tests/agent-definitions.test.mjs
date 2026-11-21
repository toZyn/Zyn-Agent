import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-definitions-'));
process.env.ZYN_DATA_DIR=root;
const require=createRequire(import.meta.url);
const {defineAgent,readAgent,listDefinitions,removeDefinition}=require('../src/core/agent-definitions.js');

test('agent definitions survive repeated reads and retain their role and instructions',()=>{
  try {
    const record=defineAgent({name:'storage-reviewer',role:'review',instructions:'Inspect storage and explain results.',allowedTools:['list_dir','read_file']});
    assert.equal(record.name,'storage-reviewer');
    assert.equal(readAgent('storage-reviewer').instructions,'Inspect storage and explain results.');
    assert.equal(listDefinitions().length,1);
    defineAgent({name:'storage-reviewer',role:'plan',instructions:'Prepare a plan.'});
    assert.equal(readAgent('storage-reviewer').role,'plan');
    assert.equal(readAgent('storage-reviewer').createdAt,record.createdAt);
    assert.equal(removeDefinition('storage-reviewer'),true);
    assert.equal(readAgent('storage-reviewer'),null);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('rejects unsafe names, empty prompts, and privileges outside supported tools',()=>{
  assert.throws(()=>defineAgent({name:'../escape',instructions:'test'}),/name/);
  assert.throws(()=>defineAgent({name:'reviewer',instructions:''}),/instructions/);
  assert.throws(()=>defineAgent({name:'reviewer',role:'owner',instructions:'do stuff'}),/role/);
  assert.throws(()=>defineAgent({name:'reviewer',role:'review',instructions:'do stuff',allowedTools:['plugin_admin']}),/unsupported tools/);
});
