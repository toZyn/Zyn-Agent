const auth=require('../../src/auth/chatgpt');
auth.getChatGPTStatus=async()=>({connected:false,sharing:false});
auth.startChatGPTLogin=async()=>{
 let reject;
 const done=new Promise((resolve,fail)=>{reject=fail});
 done.catch(()=>{});
 return {
 url:'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=THIS_IS_A_LONG_PRIVATE_LOGIN_URL_THAT_SHOULD_NOT_BE_PRINTED',
 done,
 cancel(){reject(new Error('Login cancelled'))}
 };
};
require('../../src/auth/browser').openChatGPTAuthBrowser=()=>true;
require('../../src/core/clipboard').copyToClipboard=()=>({method:'fixture',verified:true});
