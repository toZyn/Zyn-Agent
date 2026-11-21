const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);

const AGENTS_TEMPLATE='# Project instructions\n\n## Scope\n\nDescribe this repository, its entry points and the main architecture.\n\n## Development\n\nDocument installation, test and build commands.\n\n## Verification\n\nRun relevant tests before claiming changes work. Do not overwrite user data or bypass approval requirements.\n';
async function createProjectInstructions(cwd){
  const filename=path.join(path.resolve(cwd),'AGENTS.md');
  try{await fs.writeFile(filename,AGENTS_TEMPLATE,{flag:'wx',encoding:'utf8'});return{created:true,filename};}
  catch(error){if(error.code==='EEXIST')return{created:false,filename};throw error;}
}
async function readGitDiff(cwd){
  try{
    const options={cwd:path.resolve(cwd),timeout:6000,maxBuffer:128*1024};
    const [{stdout:status},{stdout:diff}]=await Promise.all([
      execFileAsync('git',['status','--short'],options),
      execFileAsync('git',['diff','--no-ext-diff','--no-color','HEAD'],options),
    ]);
    return `Git status:\n${status||'(clean)'}\n\nTracked diff:\n${diff||'(no tracked changes)'}`.slice(0,60000);
  }catch(error){if(error.code==='ENOENT')return'Git is not installed';if(/not a git repository/i.test(error.stderr||''))return'Not a Git repository';throw error;}
}
function loginCommandSpec(platform){
  if(platform==='github')return{command:'gh',args:['auth','login','--hostname','github.com','--web']};
  if(platform==='gmail'||platform==='google')return{command:'gws',args:['auth','login','-s','gmail']};
  throw new Error(`Unsupported login platform: ${platform}`);
}
async function cliAuthStatus(command,args){
  try{const{stdout,stderr}=await execFileAsync(command,args,{timeout:4500,maxBuffer:12000,env:process.env});return{installed:true,authenticated:true,detail:String(stdout||stderr).split('\n')[0].slice(0,120)};}
  catch(error){return{installed:error.code!=='ENOENT',authenticated:false,detail:error.code==='ENOENT'?'CLI not installed':'Not connected or status unavailable'};}
}
async function listAuthenticationStatus(){
  const [github,gmail,account]=await Promise.all([
    cliAuthStatus('gh',['auth','status']),
    cliAuthStatus('gws',['auth','status']),
    require('../auth/chatgpt').getChatGPTStatus(),
  ]);
  return {
    github,
    chatgpt:{installed:true,authenticated:account.connected&&account.sharing,detail:account.connected ? (account.sharing?'ChatGPT plan authorized':'Connected without plan authorization') : 'Not connected'},
    gmail,
  };
}
async function environmentReport(state={}){
  const{MODELS}=require('../config');
  const auth=await listAuthenticationStatus();
  const lines=[
    `Node: ${process.version}`,
    `Platform: ${process.platform} / ${process.arch}`,
    `Working directory: ${state.cwd||process.cwd()}`,
    `Model: ${state.activeModel||'unset'}`,
    `Registered models: ${Object.keys(MODELS).length}`,
    `Tool approvals: ${state.autoApprove?'automatic':'manual'}`,
    `Plan mode: ${state.settings?.planMode?'ON':'OFF'}`,
  ];
  for(const[name,item]of Object.entries(auth))lines.push(`${name}: ${item.installed?(item.authenticated?'connected':'installed, no verified login'):'CLI not installed'}`);
  return lines.join('\n');
}
module.exports={createProjectInstructions,readGitDiff,loginCommandSpec,listAuthenticationStatus,environmentReport};
