const fs = require('node:fs/promises');
const path = require('node:path');
const { MODELS, USER_DATA_ROOT } = require('../../config');
const { getChatGPTAccessToken } = require('../../auth/chatgpt');
const { resolveAccountModelKey } = require('../model-id');
const BASE_URL = 'https://api.openai.com/v1';

async function fetchAvailableChatGPTModels(options = {}) {
  const token = await (options.getAccessToken || getChatGPTAccessToken)(options);
  const response = await (options.fetcher || fetch)(`${BASE_URL}/models`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: options.signal,
  });
  if (!response.ok) throw new Error(`Unable to retrieve ChatGPT models (HTTP ${response.status})`);
  const body = await response.json();
  if (!Array.isArray(body.models)) throw new Error('ChatGPT did not return a model list');
  return body.models.filter(model => model?.visibility === 'list' && typeof model.slug === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(model.slug))
    .map(model => ({ slug: model.slug, label: String(model.display_name || model.slug).slice(0,120) }));
}

async function refreshChatGPTCatalog(options = {}) {
  const models = await fetchAvailableChatGPTModels(options);
  for (const key of Reflect.ownKeys(MODELS)) {
    if (typeof key === 'string' && MODELS[key]?.provider === 'chatgpt' && key !== 'chatgpt-account') delete MODELS[key];
  }
  for (const model of models) {
    const key = resolveAccountModelKey(model.slug, MODELS);
    const descriptor = { label: model.label, provider: 'chatgpt', modelId: model.slug, contextLength: 128000 };
    MODELS[key] = descriptor;
    const legacy = `chatgpt-${model.slug}`;
    if (!Object.prototype.hasOwnProperty.call(MODELS, legacy)) {
      Object.defineProperty(MODELS, legacy, { value: descriptor, enumerable: false, configurable: true });
    }
  }
  const folder = path.resolve(options.directory || path.join(USER_DATA_ROOT, 'chatgpt'));
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'models.json'), JSON.stringify({ models }), { mode: 0o600 });
  return models;
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); } catch { throw new Error('Invalid ChatGPT streaming response'); }
}

async function runChatGPTResponses(messages, modelId, onChunk, options = {}) {
  const selectedModel = modelId || (await fetchAvailableChatGPTModels(options))[0]?.slug;
  if (!selectedModel) throw new Error('No eligible ChatGPT model is available for this account');
  const token = await (options.getAccessToken || getChatGPTAccessToken)(options);
  const instructions = messages.filter(item => item.role === 'system' || item.role === 'developer').map(item => String(item.content || '')).join('\n\n');
  const input = messages.filter(item => item.role === 'user' || item.role === 'assistant')
    .map(item => ({ role: item.role, content: String(item.content || '') }));
  const body = { model: selectedModel, input, store: false, stream: true };
  if (instructions) body.instructions = instructions;
  const response = await (options.fetcher || fetch)(`${BASE_URL}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body), signal: options.signal,
  });
  if (!response.ok) throw new Error(`ChatGPT model request failed (HTTP ${response.status})`);
  if (!response.body) throw new Error('ChatGPT returned no response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', output = '', completed = false, bytes = 0;
  const consume = chunk => {
    const event = parseSseFrame(chunk);
    if (!event) return;
    if (event.type === 'response.output_text.delta') {
      const delta = String(event.delta || '');
      output += delta;
      if (onChunk && delta) onChunk(delta, 'answer');
    }
    if (event.type === 'response.failed' || event.type === 'error') {
      throw new Error(String(event.response?.error?.message || event.error?.message || event.message || 'ChatGPT response failed').slice(0,300));
    }
    if (event.type === 'response.completed') completed = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 10 * 1024 * 1024) throw new Error('ChatGPT response exceeded 10 MB limit');
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, end);
        const separator = buffer.slice(end).match(/^\r?\n\r?\n/)[0];
        buffer = buffer.slice(end + separator.length);
        consume(frame);
      }
    }
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('ChatGPT stream ended without response.completed');
  return { text: output, thinking: '', usage: null, hasContent: Boolean(output.trim()) };
}
module.exports = { fetchAvailableChatGPTModels, refreshChatGPTCatalog, runChatGPTResponses };
