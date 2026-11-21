const READ_ONLY = new Set(['list_dir','read_file','search_text','glob_files','file_info','fetch_url','webfetch','scrape_site','web_search','web_read','load_skill','ask_user']);
function toolIsReadOnly(call) {
  const name=String(call?.tool||'');
  const args=call?.args||{};
  if(READ_ONLY.has(name))return true;
  if(name==='memory')return ['get','list','search'].includes(String(args.action||'list').toLowerCase());
  if(name==='git')return args.action==='api' && ['GET','HEAD'].includes(String(args.method||'GET').toUpperCase());
  if(name==='fetch_http'||name==='fetch')return ['GET','HEAD'].includes(String(args.method||'GET').toUpperCase());
  return false;
}
function assertToolAllowed(call,state){
  if(state?.settings?.planMode && !toolIsReadOnly(call))throw new Error(`Plan mode is read-only: ${call?.tool||'unknown'} is not permitted. Disable /plan first.`);
}
module.exports={toolIsReadOnly,assertToolAllowed};
