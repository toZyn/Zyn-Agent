const {spawn:defaultSpawn}=require('node:child_process');
const {execFileSync}=require('node:child_process');
function parseGwsAuthStatus(raw){
 try{const data=JSON.parse(String(raw));return data.token_valid===true;}catch{}
 return /\btoken_valid\s*[:=]\s*true\b/i.test(String(raw));
}
function isGwsConnected(){
 try{const text=execFileSync('gws',['auth','status'],{encoding:'utf8',timeout:4500,maxBuffer:8192});return parseGwsAuthStatus(text)}catch{return false}
}
async function gwsGmailAction(action,params={},body=null,options={}){
 const methods={list:'list',read:'get',send:'send'};
 const method=methods[action];
 if(!method)throw new Error(`Unsupported Gmail action: ${action}`);
 const argv=['gmail','users','messages',method,'--params',JSON.stringify({userId:'me',...params})];
 if(action==='send')argv.push('--json',JSON.stringify(body||{}));
 const spawn=options.spawn||defaultSpawn;
 return new Promise((resolve,reject)=>{
  let child;
  try{child=spawn('gws',argv,{stdio:['pipe','pipe','pipe'],env:process.env});}catch(error){reject(error);return}
  let stdout='',stderr='',ended=false;
  const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);if(error)reject(error);else{try{resolve(JSON.parse(stdout))}catch{reject(new Error('Google Workspace CLI returned non-JSON output'))}}};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('Gmail CLI timed out'))},options.timeoutMs||30000);
  child.stdout?.on('data',data=>{stdout+=data.toString();if(stdout.length>1024*1024){child.kill('SIGTERM');finish(new Error('Gmail response too large'))}});
  child.stderr?.on('data',data=>{stderr=(stderr+data).slice(-1500)});
  child.on('error',error=>finish(error.code==='ENOENT'?new Error('Google Workspace CLI not installed'):error));
  child.on('close',code=>finish(code===0?null:new Error(`Gmail CLI failed: ${stderr.slice(-500)}`)));
  child.stdin?.end();
 });
}
module.exports={parseGwsAuthStatus,isGwsConnected,gwsGmailAction};
