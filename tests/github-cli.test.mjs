import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const{executeGithubCliApi}=require('../src/integrations/github-cli');
test('GitHub CLI API uses authenticated gh without copying its tokens',async()=>{
 let received='';let args;
 const{Readable,Writable}=await import('node:stream');
 const{EventEmitter}=await import('node:events');
 const spawn=(cmd,argv)=>{
   assert.equal(cmd,'gh');args=argv;
   const child=new EventEmitter();const stdout=new Readable({read(){}});const stderr=new Readable({read(){}});
   child.stdout=stdout;child.stderr=stderr;child.kill=()=>{};
   child.stdin=new Writable({write(chunk,enc,done){received+=chunk.toString();done();},final(done){stdout.push('{"full_name":"owner/repo"}');stdout.push(null);stderr.push(null);setImmediate(()=>child.emit('close',0));done()}});
   return child;
 };
 const res=await executeGithubCliApi({path:'repos/owner/repo',method:'PATCH',body:{description:'new'}},{spawn});
 assert.match(res,/owner\/repo/);assert.equal(args.includes('--hostname'),true);assert.match(received,/description/);
 assert.ok(!args.some(x=>/token/i.test(x)));
});
test('GitHub CLI API rejects URLs and paths outside github.com',async()=>{
 await assert.rejects(()=>executeGithubCliApi({path:'https://example.com',method:'GET'}),/path/i);
 await assert.rejects(()=>executeGithubCliApi({path:'../admin',method:'GET'}),/path/i);
});
