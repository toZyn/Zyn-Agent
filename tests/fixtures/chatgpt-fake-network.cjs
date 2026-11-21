const originalFetch = global.fetch;
global.fetch = async (input, options) => {
  const url = String(input);
  if (url === 'https://api.openai.com/v1/models') {
    return new Response(JSON.stringify({models:[{slug:'tui-test-model',display_name:'TUI test model',visibility:'list'}]}),{status:200});
  }
  if (url === 'https://api.openai.com/v1/responses') {
    const request = JSON.parse(options.body);
    if (request.store !== false || request.stream !== true || request.model !== 'tui-test-model')throw new Error('Invalid ChatGPT account request');
    const answer = JSON.stringify({type:'final',content:'Direct ChatGPT account path verified'});
    const frame = `data: ${JSON.stringify({type:'response.output_text.delta',delta:answer})}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":123,"output_tokens":30,"total_tokens":153}}}\n\n`;
    return new Response(frame,{status:200,headers:{'Content-Type':'text/event-stream'}});
  }
  return originalFetch(input,options);
};
