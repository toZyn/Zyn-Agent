import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseFrontmatter, listSkills, loadSkill, readSkillResource } = require('../src/core/skills');
const setup = () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-skill-test-'));
 const folder=path.join(root,'.agents','skills','audit-code');
 fs.mkdirSync(path.join(folder,'references'),{recursive:true});
 fs.mkdirSync(path.join(folder,'scripts'),{recursive:true});
 fs.writeFileSync(path.join(folder,'SKILL.md'),'---\nname: audit-code\ndescription: >-\n  Audit a codebase\n  safely\nlicense: MIT\n---\n# Audit\nRead [policy](references/policy.md).\n');
 fs.writeFileSync(path.join(folder,'references','policy.md'),'Do not skip tests');
 fs.writeFileSync(path.join(folder,'scripts','verify.js'),'console.log(42)');
 return {root,folder};
};
test('frontmatter YAML handles block scalars and metadata',()=>{
 const {meta}=parseFrontmatter('---\nname: audit-code\ndescription: >-\n  Audit carefully\n  and safely\n---\nBody');
 assert.equal(meta.description,'Audit carefully and safely');
});
test('skills discover standard project folders, list resources, read resource on demand',()=>{
 const {root}=setup();
 try {
  const options={cwd:root,home:path.join(root,'user'),legacyDir:path.join(root,'legacy')};
  const entries=listSkills(options);
  assert.equal(entries[0].name,'audit-code');
  const skill=loadSkill('audit-code',options);
  assert.match(skill.body,/Read \[policy\]/);
  assert.ok(!skill.body.includes('console.log(42)'));
  assert.deepEqual(skill.resources.sort(),['references/policy.md','scripts/verify.js']);
  assert.equal(readSkillResource('audit-code','references/policy.md',options),'Do not skip tests');
  assert.equal(readSkillResource('audit-code','scripts/verify.js',options),'console.log(42)');
  assert.throws(()=>readSkillResource('audit-code','../SKILL.md',options),/invalid|outside|path/i);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('duplicate skills prefer project over personal directories',()=>{
 const {root}=setup();
 const userSkill=path.join(root,'user','.agents','skills','audit-code');
 fs.mkdirSync(userSkill,{recursive:true});
 fs.writeFileSync(path.join(userSkill,'SKILL.md'),'---\nname: audit-code\ndescription: Personal\n---\nPERSONAL');
 try {assert.match(loadSkill('audit-code',{cwd:root,home:path.join(root,'user'),legacyDir:path.join(root,'legacy')}).body,/Read \[policy\]/)} finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('bundled skill collection remains discoverable and valid', () => {
 const all = listSkills({ cwd: path.join(os.tmpdir(), 'zyn-no-project'), home: path.join(os.tmpdir(), 'zyn-no-home') });
 assert.ok(all.length >= 12, `bundled skills missing: ${all.map(s=>s.name).join(',')}`);
});

test('installs a complete skill including scripts and references and rejects traversal', async () => {
 const { installSkill } = require('../src/core/skills');
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zyn-install-test-'));
 const content = {
  '': [{name:'SKILL.md',type:'file',size:78,download_url:'https://example.test/SKILL.md'},{name:'references',type:'dir'}],
  'references': [{name:'guide.md',type:'file',size:10,download_url:'https://example.test/guide.md'}],
 };
 const fetcher = async (url) => {
  const u = new URL(url);
  if (u.hostname==='example.test') {
   const data = u.pathname.endsWith('SKILL.md') ? '---\nname: repo-helper\ndescription: Repository helper\n---\nSee references/guide.md' : 'Read me';
   return {ok:true,arrayBuffer:async()=>Buffer.from(data)};
  }
  const tail = u.pathname.split('/contents/')[1] || '';
  return {ok:true,json:async()=>content[decodeURIComponent(tail)]};
 };
 try {
  const value = await installSkill('owner/repo',null,{fetch:fetcher,directory:temp});
  assert.equal(value.name,'repo-helper');
  assert.equal(fs.readFileSync(path.join(temp,'repo-helper','references','guide.md'),'utf8'),'Read me');
  const named=await installSkill('owner/repo','renamed-helper',{fetch:fetcher,directory:temp});
  assert.equal(named.name,'renamed-helper');
  const discovered=loadSkill('renamed-helper',{cwd:path.join(temp,'other'),home:path.join(temp,'none'),legacyDir:temp});
  assert.equal(discovered?.name,'renamed-helper');
  assert.throws(()=>require('../src/core/skills').parseGitHubLocation('owner/repo/../evil'),/Invalid/);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});


test('agent tool loads a resource from a project skill on demand', async()=>{
 const {root}=setup();
 try {
  const {executeToolCall}=require('../src/tools');
  const output=await executeToolCall({tool:'load_skill',args:{name:'audit-code',resource:'references/policy.md'}},{cwd:root,language:'en'}, {logEvent(){}});
  assert.match(String(output),/Do not skip tests/);
  assert.doesNotMatch(String(output),/console\.log\(42\)/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('rate-limited GitHub API falls back to a bounded git skill directory download', async () => {
 const {installSkill}=require('../src/core/skills');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-skill-fallback-'));
 let usedFallback=false;
 try {
  const result=await installSkill('owner/repo/skills/helper',null,{
   directory:dir,
   fetch:async()=>({ok:false,status:403}),
   clone:async ({subpath})=>{
     assert.equal(subpath,'skills/helper');usedFallback=true;
     return [{path:'SKILL.md',content:Buffer.from('---\nname: offline-helper\ndescription: Works without API access\n---\nHelp')},{path:'references/guide.md',content:Buffer.from('Reference')}];
   },
  });
  assert.equal(result.files,2);
  assert.equal(usedFallback,true);
  assert.equal(fs.readFileSync(path.join(dir,'offline-helper','references','guide.md'),'utf8'),'Reference');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
