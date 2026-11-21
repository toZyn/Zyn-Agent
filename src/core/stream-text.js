const { scanAssistantParts, classifyAssistantParts } = require('./response-protocol');
function assistantStreamText(raw) {
  const parts = classifyAssistantParts(scanAssistantParts(raw));
  const text = parts.filter(part => part.type === 'answer').map(part => part.content).join('\n\n');
  return text || null;
}
module.exports = { assistantStreamText };
