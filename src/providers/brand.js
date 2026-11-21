const BRANDS = Object.freeze({
  anthropic: ['Anthropic', 'AN', '#c2a287', 'anthropic'],
  azure: ['Microsoft Azure', 'AZ', '#0078d4', 'microsoftazure'],
  bedrock: ['Amazon Bedrock', 'AWS', '#ff9900', 'amazonaws'],
  chutes: ['Chutes', 'CH', '#42b883', null],
  cohere: ['Cohere', 'CO', '#39594d', 'cohere'],
  chatgpt: ['ChatGPT plan', 'CG', '#10a37f', 'openai'],
  deepseek: ['DeepSeek', 'DS', '#4d6bfe', 'deepseek'],
  fireworks: ['Fireworks AI', 'FW', '#db4539', 'fireworks'],
  gemini: ['Google Gemini', 'GM', '#4285f4', 'googlegemini'],
  github: ['GitHub Models', 'GH', '#8589a0', 'github'],
  groq: ['Groq', 'GQ', '#f54c2e', 'groq'],
  huggingface: ['Hugging Face', 'HF', '#ffd21e', 'huggingface'],
  inference: ['Inference', 'IF', '#777777', null],
  lmstudio: ['LM Studio', 'LM', '#4c8ed7', null],
  mistral: ['Mistral AI', 'MI', '#f7a830', 'mistralai'],
  novita: ['Novita', 'NV', '#7955c8', null],
  ollama: ['Ollama', 'OL', '#777777', 'ollama'],
  ollamaCloud: ['Ollama Cloud', 'OC', '#777777', 'ollama'],
  openai: ['OpenAI', 'OA', '#10a37f', 'openai'],
  openrouter: ['OpenRouter', 'OR', '#7d71c5', 'openrouter'],
  perplexity: ['Perplexity', 'PX', '#20b2aa', 'perplexity'],
  qwenapi: ['Qwen', 'QW', '#615ced', 'qwen'],
  replicate: ['Replicate', 'RP', '#444444', 'replicate'],
  together: ['Together AI', 'TG', '#e04d35', 'together'],
  vertex: ['Vertex AI', 'VX', '#4285f4', 'googlecloud'],
  xai: ['xAI', 'XA', '#777777', 'x'],
  zen: ['Zen', 'ZN', '#8294bf', null],
  zyncloud: ['Zyn Cloud', 'ZY', '#111111', null],
});
function getProviderBrand(key) {
  const [label, mark, color, slug] = BRANDS[key] || [String(key || 'Unknown'), 'AI', '#777777', null];
  return {key, label, mark, color, logo: slug ? `https://cdn.simpleicons.org/${slug}` : null};
}
function listProviderBrands(){return Object.keys(BRANDS).map(getProviderBrand)}
module.exports={getProviderBrand,listProviderBrands};
