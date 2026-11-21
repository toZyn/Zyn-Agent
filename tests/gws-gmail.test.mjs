import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {gwsGmailAction,parseGwsAuthStatus}=require('../src/integrations/gws-gmail');
test('GWS must report a valid OAuth token rather than merely CLI installed',()=>{
 assert.equal(parseGwsAuthStatus('{"token_valid":false,"auth_method":"oauth2"}'),false);
 assert.equal(parseGwsAuthStatus('{"token_valid":true,"auth_method":"oauth2"}'),true);
 assert.equal(parseGwsAuthStatus('token_valid: false'),false);
});
test('GWS Gmail command uses scoped JSON params, not shell',async()=>{
 let args;const{EventEmitter}=await import('node:events');const{Readable,Writable}=await import('node:stream');
 const spawn=(cmd,a)=>{assert.equal(cmd,'gws');args=a;const child=new EventEmitter();child.stdout=new Readable({read(){}});child.stderr=new Readable({read(){}});child.stdin=new Writable({write(chunk,enc,cb){cb()},final(cb){child.stdout.push('{"messages":[]}');child.stdout.push(null);child.stderr.push(null);setImmediate(()=>child.emit('close',0));cb()}});child.kill=()=>{};return child};
 const result=await gwsGmailAction('list',{q:'is:unread',maxResults:5},null,{spawn});
 assert.deepEqual(result,{messages:[]});assert.equal(args[0],'gmail');assert.equal(args[3],'list');assert.match(args[5],/is:unread/);
});
