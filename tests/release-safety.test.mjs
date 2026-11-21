import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const yaml=require('yaml');
const root=process.cwd();
const load=filename=>yaml.parse(fs.readFileSync(path.join(root,filename),'utf8'));

test('npm publish is manual only, never triggered by a GitHub release',()=>{
 const workflow=load('.github/workflows/publish.yml');
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
 assert.ok(workflow.jobs.publish.steps.some(step=>String(step.run||'').includes('npm publish')));
 assert.ok(!JSON.stringify(workflow.on).includes('release'));
});

test('GitHub release workflow validates release commit, runs tests, and creates its GitHub release',()=>{
 const workflow=load('.github/workflows/github-release.yml');
 assert.deepEqual(workflow.on.push.branches,['main']);
 const job=workflow.jobs['github-release'];
 assert.match(job.if,/startsWith.*release: v/);
 const steps=job.steps;
 assert.ok(steps.some(step=>String(step.run||'').includes('npm run test:all')));
 const publish=steps.find(step=>String(step.run||'').includes('gh release create'));
 assert.ok(publish);
 assert.match(publish.run,/\$GITHUB_SHA/);
 assert.match(publish.run,/docs\/releases/);
 assert.ok(!publish.run.includes('npm publish'));
});

test('release notes and changelog reflect package version, not npm availability claims',()=>{
 const version=require('../package.json').version;
 const notes=fs.readFileSync(path.join(root,'docs','releases',`v${version}.md`),'utf8');
 const changelog=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8');
 assert.match(notes,new RegExp(`Zyn Agent v${version.replace(/\./g,'\\.')}`));
 assert.equal(notes,changelog);
 assert.match(notes,/not.*publish.*npm/i);
});

test('command reference is generated from every registered slash command',()=>{
 const {SLASH_COMMANDS}=require('../src/cli/commands');
 const docs=fs.readFileSync(path.join(root,'docs','COMMANDS.md'),'utf8');
 assert.ok(SLASH_COMMANDS.length >= 45);
 for(const command of SLASH_COMMANDS)assert.ok(docs.includes(`| \`/${command.name}\` |`),`Missing documentation for /${command.name}`);
});
