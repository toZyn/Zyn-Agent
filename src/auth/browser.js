const {spawn:defaultSpawn}=require('node:child_process');
function buildBrowserLaunch(url,options={}){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!=='auth.openai.com')throw new Error('OpenAI authorization URL required');
  const platform=options.platform||process.platform;
  if(platform==='darwin')return{command:'open',args:[url]};
  if(platform==='win32')return{command:'rundll32.exe',args:['url.dll,FileProtocolHandler',url]};
  if(String(options.prefix===undefined?process.env.PREFIX||'':options.prefix).includes('com.termux'))return{command:'termux-open-url',args:[url]};
  return{command:'xdg-open',args:[url]};
}
function openChatGPTAuthBrowser(url,options={}){
  const{command,args}=buildBrowserLaunch(url,options);
  try{
    const child=(options.spawn||defaultSpawn)(command,args,{stdio:'ignore',detached:true,env:process.env});
    child.on('error',()=>{});
    child.unref();
    return true;
  }catch{return false}
}
module.exports={buildBrowserLaunch,openChatGPTAuthBrowser};
