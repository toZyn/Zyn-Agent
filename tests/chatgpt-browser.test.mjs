import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildBrowserLaunch,openChatGPTAuthBrowser}=require('../src/auth/browser');

test('authorization browser launcher uses OS commands without a shell',()=>{
 assert.deepEqual(buildBrowserLaunch('https://auth.openai.com/authorize',{platform:'darwin'}),{command:'open',args:['https://auth.openai.com/authorize']});
 assert.deepEqual(buildBrowserLaunch('https://auth.openai.com/authorize',{platform:'linux',prefix:'/data/data/com.termux/files/usr'}),{command:'termux-open-url',args:['https://auth.openai.com/authorize']});
 assert.throws(()=>buildBrowserLaunch('https://evil.example.com/'),/OpenAI authorization/);
});
test('launcher does not reveal credentials to a shell or crash if browser is unavailable',()=>{
 let used='';
 const result=openChatGPTAuthBrowser('https://auth.openai.com/api/accounts/authorize',{platform:'linux',spawn:(command,args,opts)=>{used=command;assert.equal(opts.shell,undefined);assert.equal(args.length,1);return{on(){},unref(){}}}});
 assert.equal(result,true);assert.equal(used,'xdg-open');
});
