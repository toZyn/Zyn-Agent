const {spawn:defaultSpawn}=require('node:child_process');
function validateGithubApi(args){
 const name=String(args?.path||'').replace(/^\/+/, '');
 if(!name||name.includes('\\')||/^(https?:|\.)/i.test(name)||name.split(/[/?#]/).includes('..')||/%2e%2e|%2f/i.test(name))throw new Error('Invalid GitHub API path');
 const method=String(args?.method||'GET').toUpperCase();
 if(!['GET','HEAD','POST','PATCH','PUT','DELETE'].includes(method))throw new Error('Unsupported GitHub method');
 return{name,method};
}
async function executeGithubCliApi(request,options={}){
 const{name,method}=validateGithubApi(request);
 const argv=['api','--hostname','github.com',name,'--method',method];
 if(request.body!==undefined){if(method==='GET'||method==='HEAD')throw new Error('GET/HEAD cannot include a JSON body');argv.push('--input','-')}
 const spawn=options.spawn||defaultSpawn;
 const timeout=options.timeoutMs||30000;
 return new Promise((resolve,reject)=>{
  let child;
  try{child=spawn('gh',argv,{stdio:['pipe','pipe','pipe'],env:process.env});}catch(err){reject(err);return}
  let stdout='',stderr='',closed=false;
  const finish=(err)=>{if(closed)return;closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(err)reject(err);else resolve(stdout)};
  const abort=()=>{child.kill('SIGTERM');finish(new Error('GitHub request aborted'))};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('GitHub CLI timeout'))},timeout);
  child.stdout?.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>1000000)abort()});
  child.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000)});
  child.on('error',err=>finish(err.code==='ENOENT'?new Error('GitHub CLI not installed; run zyn auth github login'):err));
  child.on('close',code=>finish(code===0?null:new Error(`GitHub CLI ${code}: ${stderr.slice(-500)}`)));
  if(options.signal?.aborted){abort();return}
  options.signal?.addEventListener('abort',abort,{once:true});
  child.stdin?.end(request.body===undefined?'':JSON.stringify(request.body));
 });
}
module.exports={validateGithubApi,executeGithubCliApi};
