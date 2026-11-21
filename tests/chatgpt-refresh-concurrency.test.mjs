import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

const launch=(url,directory)=>new Promise((resolve,reject)=>{
 const script=`const {getChatGPTAccessToken}=require('./src/auth/chatgpt');getChatGPTAccessToken({directory:process.env.TEST_AUTH_DIR,fetcher:(u,o)=>fetch(process.env.TEST_AUTH_ENDPOINT,{method:'POST',body:o.body})}).then(t=>process.stdout.write(t)).catch(e=>{process.stderr.write(e.message);process.exitCode=1});`;
 const child=spawn(process.execPath,['-e',script],{cwd:process.cwd(),env:{...process.env,TEST_AUTH_DIR:directory,TEST_AUTH_ENDPOINT:url},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('close',code=>code===0?resolve(stdout):reject(new Error(stderr)));
});

test('two Zyn processes renew one rotating OAuth token without racing each other',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-shared-token-'));
 fs.writeFileSync(path.join(folder,'account.json'),JSON.stringify({clientId:'oaiapp_test',subject:'sub',accessToken:'expired',refreshToken:'original',scopes:['chatgpt.tokens.use.direct'],expiresAt:1}),{mode:0o600});
 let current='original',requests=0;
 const server=http.createServer(async(req,res)=>{
  let text='';for await(const part of req)text+=part;
  const value=new URLSearchParams(text).get('refresh_token');
  requests++;
  if(value!==current){res.writeHead(401);res.end('reuse');return;}
  current='rotated-'+requests;
  await new Promise(resolve=>setTimeout(resolve,120));
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({access_token:'new-token',refresh_token:current,expires_in:3600,token_type:'Bearer',scope:'chatgpt.tokens.use.direct'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const url=`http://127.0.0.1:${server.address().port}/token`;
  const [a,b]=await Promise.all([launch(url,folder),launch(url,folder)]);
  assert.equal(a,'new-token');assert.equal(b,'new-token');assert.equal(requests,1);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
});
