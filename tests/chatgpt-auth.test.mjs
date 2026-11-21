import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {startChatGPTLogin,loadChatGPTAccount,getChatGPTHostId,refreshChatGPTAccount,getChatGPTStatus,disconnectChatGPT} =require('../src/auth/chatgpt');

function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zyn-siwc-'));return {directory,clean:()=>fs.rmSync(directory,{recursive:true,force:true})};}
function authFetcher(calls){return async(url,options={})=>{
 calls.push({url,options});
 if(url.includes('/oauth/token'))return new Response(JSON.stringify({access_token:'a-access',refresh_token:'a-refresh',id_token:'ey.sample.token',scope:'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct',expires_in:3600,token_type:'Bearer'}),{status:200,headers:{'content-type':'application/json'}});
 throw Error('unexpected request '+url);
};}

test('dynamic registration asks for plan consent using PKCE and binds callback to 127.0.0.1',async()=>{
 const f=fixture(),calls=[];
 try{
  const flow=await startChatGPTLogin({directory:f.directory,fetcher:authFetcher(calls),verifyIdentity:async()=>({sub:'subject1',email:'user@example.test'}),timeoutMs:4000});
  const auth=new URL(flow.url);
  assert.equal(auth.host,'auth.openai.com');
  assert.equal(auth.pathname,'/api/accounts/authorize');
  assert.equal(auth.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(auth.searchParams.get('agent_name_hint'),'Zyn Agent');
  assert.ok(auth.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  assert.match(auth.searchParams.get('ext_agent_host_id'),/^urn:uuid:/);
  assert.equal(auth.searchParams.get('redirect_uri').split('/')[2].startsWith('127.0.0.1:'),true);
  const callback=new URL(auth.searchParams.get('redirect_uri'));
  callback.searchParams.set('code','sample-code');callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('client_id','oaiapp_new');
  const res=await fetch(callback);
  assert.equal(res.status,200);
  const account=await flow.done;
  assert.equal(account.sharing,true);
  assert.equal(account.clientId,'oaiapp_new');
  assert.equal(account.subject,'subject1');
  assert.ok(!JSON.stringify(account).includes('a-access'));
  const stored=await loadChatGPTAccount({directory:f.directory});
  assert.equal(stored.accessToken,'a-access');
  assert.equal(fs.statSync(path.join(f.directory,'account.json')).mode&0o077,0);
  assert.equal(new URLSearchParams(calls[0].options.body).get('client_id'),'oaiapp_new');
  assert.equal(new URLSearchParams(calls[0].options.body).get('code_verifier').length>20,true);
  assert.equal(new URLSearchParams(calls[0].options.body).get('resource'),'https://api.openai.com/v1');
 }finally{f.clean()}
});

test('wrong state or missing issued ID cannot authorize a new account',async()=>{
 const f=fixture();let network=0;
 try{
  const flow=await startChatGPTLogin({directory:f.directory,fetcher:async()=>{network++;throw Error('no exchange')},verifyIdentity:async()=>({sub:'x'}),timeoutMs:2000});
  const auth=new URL(flow.url),url=new URL(auth.searchParams.get('redirect_uri'));
  url.searchParams.set('code','bad');url.searchParams.set('state','wrong');url.searchParams.set('client_id','oaiapp_new');
  const res=await fetch(url);assert.equal(res.status,400);
  await assert.rejects(flow.done,/state/i);
  assert.equal(network,0);assert.equal(await loadChatGPTAccount({directory:f.directory}),null);
 }finally{f.clean()}
});

test('refresh replaces rotating credentials without exposing account token',async()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.directory,'account.json'),JSON.stringify({clientId:'oaiapp_existing',subject:'subject1',email:'u@test',accessToken:'old',refreshToken:'old-refresh',expiresAt:1,scopes:['chatgpt.tokens.use.direct']}));
  const calls=[];const fetcher=async(url,opts)=>{calls.push(opts);return new Response(JSON.stringify({access_token:'new',refresh_token:'rotated',token_type:'Bearer',expires_in:3600,scope:'chatgpt.tokens.use.direct'}),{status:200})};
  const updated=await refreshChatGPTAccount({directory:f.directory,fetcher});
  assert.equal(updated.accessToken,'new');assert.equal(updated.refreshToken,'rotated');
  const form=new URLSearchParams(calls[0].body);
  assert.equal(form.get('client_id'),'oaiapp_existing');assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('scope'),null);
  const status=await getChatGPTStatus({directory:f.directory});
  assert.equal(status.sharing,true);assert.ok(!JSON.stringify(status).includes('rotated'));
  const disconnected=await disconnectChatGPT({directory:f.directory,fetcher:async()=>new Response(null,{status:200})});
  assert.equal(disconnected.connected,false);
 }finally{f.clean()}
});

test('stable host id persists across restarts and never contains user identifying data',async()=>{
 const f=fixture();try{const a=await getChatGPTHostId({directory:f.directory});const b=await getChatGPTHostId({directory:f.directory});assert.equal(a,b);assert.match(a,/^urn:uuid:[0-9a-f-]{36}$/);}finally{f.clean()}
});

test('OpenID token must have a valid cryptographic signature, audience, issuer, expiry and nonce',async()=>{
 const {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet}=await import('jose');
 const {verifyChatGPTIdentity}=require('../src/auth/chatgpt');
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);jwk.kid='local-test-key';jwk.alg='RS256';
 const keys=createLocalJWKSet({keys:[jwk]});
 const signed=await new SignJWT({nonce:'expected',email:'user@example.test'}).setProtectedHeader({alg:'RS256',kid:'local-test-key'})
 .setIssuer('https://auth.openai.com').setAudience('oaiapp_user').setSubject('user-subject').setIssuedAt().setExpirationTime('3m').sign(privateKey);
 const valid=await verifyChatGPTIdentity(signed,'oaiapp_user','expected',{keys});
 assert.equal(valid.sub,'user-subject');
 await assert.rejects(()=>verifyChatGPTIdentity(signed,'other-client','expected',{keys}),/audience|aud/i);
 await assert.rejects(()=>verifyChatGPTIdentity(signed,'oaiapp_user','wrong',{keys}),/nonce/i);
 const tampered=signed.slice(0,-5)+'xxxxx';
 await assert.rejects(()=>verifyChatGPTIdentity(tampered,'oaiapp_user','expected',{keys}));
});

test('only one browser sign-in may be active and cancellation releases the callback listener',async()=>{
 const f=fixture();
 try {
  const flow=await startChatGPTLogin({directory:f.directory,timeoutMs:4000});
  await assert.rejects(()=>startChatGPTLogin({directory:f.directory,timeoutMs:4000}),/in progress|active/i);
  flow.cancel();
  await assert.rejects(flow.done,/cancel/i);
  const replacement=await startChatGPTLogin({directory:f.directory,timeoutMs:4000});
  replacement.cancel();
  await assert.rejects(replacement.done,/cancel/i);
 }finally{f.clean()}
});

test('returning sign-in reuses the assigned client ID and refuses switching subjects',async()=>{
 const f=fixture();
 try {
  fs.writeFileSync(path.join(f.directory,'account.json'),JSON.stringify({clientId:'oaiapp_original',subject:'original-sub',email:'private@example.test',idToken:'private.jwt.data',refreshToken:'old',accessToken:'old',expiresAt:1,scopes:[]}),{mode:0o600});
  const flow=await startChatGPTLogin({directory:f.directory,reconnect:true,fetcher:authFetcher([]),verifyIdentity:async()=>({sub:'imposter'}),timeoutMs:5000});
  const url=new URL(flow.url);
  assert.equal(url.searchParams.get('client_id'),'oaiapp_original');
  assert.equal(url.searchParams.get('id_token_hint'),null);
  assert.equal(url.searchParams.get('login_hint'),null);
  assert.equal(url.searchParams.get('agent_name_hint'),null);
  const callback=new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',url.searchParams.get('state'));
  callback.searchParams.set('code','reconnect-code');
  const response=await fetch(callback);
  assert.equal(response.status,400);
  await assert.rejects(flow.done,/Different ChatGPT account/i);
  assert.equal((await loadChatGPTAccount({directory:f.directory})).subject,'original-sub');
 }finally{f.clean()}
});

test('identity-only OAuth never grants ChatGPT model usage automatically',async()=>{
 const f=fixture();
 try {
  const fetcher=async()=>new Response(JSON.stringify({access_token:'identity-token',refresh_token:'refresh',id_token:'id-token',token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access'}),{status:200});
  const flow=await startChatGPTLogin({directory:f.directory,fetcher,verifyIdentity:async()=>({sub:'id-sub'}),timeoutMs:5000});
  const url=new URL(flow.url),callback=new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','identity-only');callback.searchParams.set('client_id','oaiapp_identity');
  await fetch(callback);
  assert.equal((await flow.done).sharing,false);
  const {getChatGPTAccessToken}=require('../src/auth/chatgpt');
  await assert.rejects(getChatGPTAccessToken({directory:f.directory}),/not approved|not authorized/i);
 }finally{f.clean()}
});
