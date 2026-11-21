const { MODELS, DEFAULT_MODEL_KEY } = require('../config');

function estimateTokens(text) {
  return Math.ceil(Array.from(String(text || '')).length / 4);
}

function sessionMetrics(state = {}) {
  const history = Array.isArray(state.history) ? state.history : [];
  const actionLog = Array.isArray(state.actionLog) ? state.actionLog : [];
  const historyCharacters = history.reduce((sum, item) => sum + String(item?.content || '').length, 0);
  const contextText = [state.memorySummary, state.importedMemory, state.personaPrompt].filter(Boolean).join('\n');
  const modelKey = state.activeModel || DEFAULT_MODEL_KEY;
  const contextLength = MODELS[modelKey]?.contextLength || null;
  return {
    sessionId: String(state.sessionId || ''),
    model: modelKey,
    messages: history.length,
    turns: Number.isFinite(state.turnCount) ? state.turnCount : 0,
    actions: actionLog.length,
    historyCharacters,
    contextCharacters: contextText.length,
    estimatedTokens: estimateTokens(history.map(item => item?.content || '').join('\n') + '\n' + contextText),
    contextLength,
  };
}

function formatSessionMetrics(state, { contextOnly = false } = {}) {
  const stats = sessionMetrics(state);
  const es = state?.language === 'es';
  const lines = [es ? 'Contexto de sesión' : 'Session context',
    `${es ? 'Modelo' : 'Model'}: ${stats.model}`,
    `${es ? 'Mensajes almacenados' : 'Stored messages'}: ${stats.messages}`,
    `${es ? 'Caracteres del historial' : 'History characters'}: ${stats.historyCharacters}`,
    `${es ? 'Caracteres de memoria/perfil' : 'Memory/profile characters'}: ${stats.contextCharacters}`,
    `${es ? 'Tokens estimados (texto, no medición)' : 'Estimated tokens (text approximation, not measured)'}: ${stats.estimatedTokens}`,
    `${es ? 'Límite de contexto declarado' : 'Declared context limit'}: ${stats.contextLength || (es ? 'no disponible' : 'unavailable')}`,
  ];
  if (!contextOnly) {
    lines.push(`${es ? 'Turnos' : 'Turns'}: ${stats.turns}`,
      `${es ? 'Acciones registradas' : 'Recorded actions'}: ${stats.actions}`,
      es ? 'Uso facturable real: no disponible; consulta al proveedor.' : 'Actual billed usage: unavailable; check your provider.');
  }
  return lines.join('\n');
}

module.exports = { estimateTokens, sessionMetrics, formatSessionMetrics };
