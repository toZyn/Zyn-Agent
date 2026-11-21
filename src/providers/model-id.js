function modelDisplayId(key, descriptor = {}) {
  if (key === 'chatgpt-account' && descriptor.provider === 'chatgpt') return 'auto';
  const value = descriptor.modelId || descriptor.slug || key;
  return String(value || key);
}
function resolveAccountModelKey(slug, models) {
  if (models[slug] && models[slug].provider !== 'chatgpt') return `chatgpt:${slug}`;
  return slug;
}
function publicModelKey(key, models) {
  return modelDisplayId(key, models[key] || {});
}
module.exports = { modelDisplayId, resolveAccountModelKey, publicModelKey };
