const {
  DEFAULT_MODEL_KEY,
  KEEP_RECENT_MESSAGES,
  MAX_HISTORY_CHARS,
  MAX_TOOL_STEPS,
  MODELS,
  PROVIDER_TIMEOUT_MAX_ATTEMPTS,
  PROVIDER_TIMEOUT_RETRY_DELAY_MS,
  AUTO_COMPACT_THRESHOLD,
  countTokens,
  estimateContextTokens,
  getContextLimit,
  getSetting,
  stripBase64Images,
} = require('../config');
const { chat } = require('../providers/scraperClient');
const { AssistantStream } = require('./assistant-stream');
const {
  KNOWN_TOOLS,
  buildConversationMessages,
  buildSystemPrompt,
  buildToolErrorMessage,
  buildToolResultMessage,
  getCompactPrompt,
  parseAgentResponse,
  sanitizeArgsForModel,
  truncateHistory,
} = require('./prompts');
const {
  executeToolCall,
  parseDirectAction,
} = require('../tools');
const { appendTranscriptEntry } = require('../utils/transcriptStorage');
const { saveState } = require('../utils/sessionStorage');
const { normalizeText, shortText } = require('../utils/text');
const { detectLanguage } = require('../i18n');

function waitForRetry(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('aborted'));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(cleanupAndResolve, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('aborted'));
    };
    function cleanup() {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    function cleanupAndResolve() {
      cleanup();
      resolve();
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestModel(messages, state, ui, options = {}) {
  const {
    label = 'Thinking',
    streamOutput = false,
    signal,
  } = options;

  const maxAttempts = getSetting(state, 'providerMaxAttempts');
  const retryDelay = getSetting(state, 'providerRetryDelayMs');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error(state.language === 'es' ? 'Agente detenido por el usuario' : 'Agent stopped by user');
    }
    const stopThinking = ui.startThinkingIndicator(state, attempt === 0 ? label : `${label} (${state.language === 'es' ? 'reintento' : 'retry'})`);
    let thinkingStarted = false;
    let hasFollowedUp = false;
    const controller = new AbortController();
    const onExternalAbort = () => { stopThinking(); controller.abort(); };
    const assistantStream = new AssistantStream(state, ui, streamOutput, stopThinking);

    if (signal) {
      if (signal.aborted) { stopThinking(); controller.abort(); }
      else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const result = await chat({
        messages,
        modelKey: state?.activeModel || DEFAULT_MODEL_KEY,
        signal: controller.signal,
        onChunk: (delta, phase, metadata) => {
          if (phase === 'thinking') {
            if (!thinkingStarted) {
              stopThinking();
              ui.beginThinkingStream(state);
              thinkingStarted = true;
            }
            ui.writeThinkingDelta(state, delta);
            return;
          }
          if (thinkingStarted) {
            ui.endThinkingStream(state);
            thinkingStarted = false;
          }
          assistantStream.append(delta, metadata);
        },
      });
      ui.pushAction(state, 'ok', state.language === 'es' ? 'Respuesta recibida' : 'Answer received');
      const rawAnswer = result.answer ?? '';
      const rawThinking = result.thinking || '';

      if (!rawAnswer && rawThinking && result.hasContent === false && !hasFollowedUp) {
        console.error(`[AGENT_DEBUG] Thinking-only response detected (${rawThinking.length} chars). Triggering follow-up.`);
        const lang = state.language || 'es';
        const followUpMessages = [
          ...messages.slice(0, -1),
          { role: 'assistant', content: rawThinking },
          { role: 'user', content: lang === 'es'
            ? 'Tu razonamiento anterior es correcto. Ahora genera tu respuesta final como JSON: {"type":"final","content":"tu respuesta aqui"} o la tool call correspondiente.'
            : 'Your previous reasoning is correct. Now generate your final answer as JSON: {"type":"final","content":"your answer here"} or the corresponding tool call.' },
        ];
        hasFollowedUp = true;
        try {
          ui.pushAction(state, 'info', lang === 'es' ? 'Generando respuesta...' : 'Generating answer...');
          const followUp = await chat({
            messages: followUpMessages,
            modelKey: state?.activeModel || DEFAULT_MODEL_KEY,
            signal: controller.signal,
            onChunk: (delta, phase, metadata) => {
              if (phase === 'answer') assistantStream.append(delta, metadata);
            },
          });
          if (followUp.answer) {
            return { answer: followUp.answer, thinking: rawThinking, usage: followUp.usage || result.usage || null, ...assistantStream.finish(followUp.answer) };
          }
        } catch {}
      }

      return { answer: rawAnswer, thinking: rawThinking, usage: result.usage || null, ...assistantStream.finish(rawAnswer) };
    } catch (err) {
      assistantStream.interrupt();
      if (assistantStream.hasVisibleOutput) throw err;
      const externalAbort = Boolean(signal?.aborted);
      const aborted = controller.signal.aborted || err?.name === 'AbortError';
      if (aborted) throw new Error(state.language === 'es' ? 'Tiempo agotado' : 'Timeout');
      const is413 = err?.message?.includes('(413)') || err?.message?.includes('Payload Too Large');
      if (is413 && attempt < maxAttempts - 1) {
        const lang = state.language || 'es';
        if (!state.__payloadTruncated) {
          state.__payloadTruncated = true;
          console.error(`[AGENT_DEBUG] ${lang === 'es' ? 'Payload demasiado grande, truncando mensajes grandes...' : 'Payload too large, truncating large messages...'}`);
          const LARGE_THRESHOLD = 1000;
          const TRUNCATE_TO = 20000;
          let truncCount = 0;
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (typeof m.content === 'string' && m.content.length > LARGE_THRESHOLD) {
              const prevLen = m.content.length;
              messages[i] = {
                ...m,
                content: `${m.content.slice(0, TRUNCATE_TO)}\n[... ${lang === 'es' ? 'truncado' : 'truncated'} — ${prevLen} chars total, mostrando ${TRUNCATE_TO}. ${lang === 'es' ? 'Lee el archivo en fragmentos pequeños' : 'Read the file in small fragments'}]`,
              };
              truncCount++;
            }
          }
          console.error(`[AGENT_DEBUG] ${lang === 'es' ? `Truncados ${truncCount} mensajes` : `Truncated ${truncCount} messages`}`);
        } else {
          console.error(`[AGENT_DEBUG] ${lang === 'es' ? 'Payload sigue grande, eliminando ultimo resultado de herramienta...' : 'Payload still too large, removing last tool result...'}`);
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('TOOL_RESULT')) {
              messages.splice(i, 1);
              if (i > 0 && messages[i - 1]?.role === 'assistant' && messages[i - 1]?.content?.includes('"type":"tool"')) {
                messages.splice(i - 1, 1);
              }
              break;
            }
          }
        }
        const backoff = Math.min(retryDelay * Math.pow(2, attempt), 10000);
        await waitForRetry(backoff, signal);
        continue;
      }
      if (!externalAbort && attempt < maxAttempts - 1) {
        const backoff = Math.min(retryDelay * Math.pow(2, attempt), 10000);
        await waitForRetry(backoff, signal);
        continue;
      }
      throw err;
    } finally {
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      stopThinking();
      if (thinkingStarted) ui.endThinkingStream(state);
    }
  }
  throw new Error(state.language === 'es' ? 'Proveedor inalcanzable' : 'Provider unreachable');
}

async function autoCompact(state, ui, options = {}) {
  const lang = state.language || 'en';
  if (state.__compacting) return;
  if (!Array.isArray(state.history) || state.history.length === 0) return;

  if (!options.force) {
    const autoEnabled = getSetting(state, 'autoCompactEnabled');
    if (autoEnabled === false || autoEnabled === 0) return;

    const minMsgs = getSetting(state, 'compactMinMessages');
    if (state.history.length < minMsgs) return;

    const contextLimit = getContextLimit(state.activeModel);
    const estimatedTokens = estimateContextTokens(state);
    const compactThreshold = getSetting(state, 'autoCompactThreshold');
    if (contextLimit <= 0 || estimatedTokens <= contextLimit * compactThreshold) return;
  }

  state.__compacting = true;
  try {
    const compactPrompt = getCompactPrompt(lang);
    const messages = [{ role: 'system', content: compactPrompt }];
    if (state.memorySummary) {
      const memLabel = lang === 'es' ? 'Resumen de memoria anterior' : 'Previous memory summary';
      messages.push({ role: 'system', content: `${memLabel}:\n${state.memorySummary}` });
    }
    for (const hMsg of state.history) {
      if (hMsg && hMsg.content) messages.push({ ...hMsg });
    }

    const result = await requestModel(messages, state, ui, {
      label: lang === 'es' ? 'Compactando' : 'Compacting',
    });

    const rawAnswer = result.answer || '';
    let summary = '';

    const enMatch = rawAnswer.match(/<summary>([\s\S]*?)<\/summary>/i);
    const esMatch = rawAnswer.match(/<resumen>([\s\S]*?)<\/resumen>/i);

    if (enMatch) summary = enMatch[1].trim();
    else if (esMatch) summary = esMatch[1].trim();
    else summary = rawAnswer.trim();

    if (summary && summary.length > 100) {
      state.memorySummary = summary;
      state.history = [];
      ui.logEvent(state, 'ok', lang === 'es' ? 'Memoria compactada exitosamente' : 'Memory compacted successfully');
    } else {
      ui.logEvent(state, 'warn', lang === 'es' ? 'Resumen demasiado corto, usando truncado simple' : 'Summary too short, using simple truncation');
      truncateHistory(state);
    }
  } catch (err) {
    ui.logEvent(state, 'warn', lang === 'es' ? 'Error en compactacion, usando truncado simple' : 'Compaction error, using simple truncation');
    truncateHistory(state);
  } finally {
    state.__compacting = false;
  }
}

async function persistSessionState(state, ui) {
  const contextLimit = getContextLimit(state.activeModel);
  const estimatedTokens = estimateContextTokens(state);
  const compactThreshold = getSetting(state, 'autoCompactThreshold');
  if (contextLimit > 0 && estimatedTokens > contextLimit * compactThreshold) {
    if (!state.__compacting) {
      await autoCompact(state, ui);
    }
  }
  await saveState(state);
}

async function answerFromToolResult(input, call, result, state, ui, language, signal) {
  const systemPrompt = buildSystemPrompt(state.cwd, state, { input, language });
  const turnMessages = [
    { role: 'user', content: input },
    { role: 'assistant', content: JSON.stringify({ type: 'tool', tool: call.tool, args: call.args }) },
    { role: 'user', content: buildToolResultMessage(call, result, language) },
  ];
  const messages = buildConversationMessages(state, turnMessages, systemPrompt);
  const output = await requestModel(messages, state, ui, {
    label: language === 'es' ? 'Procesando resultado' : 'Processing result',
    streamOutput: Boolean(state.tuiConfirm),
    signal,
  });
  const parsed = output.parsed || parseAgentResponse(output.answer || '');
  const answer = parsed.type === 'final' ? String(parsed.content || '').trim() : '';
  return { content: answer || (language === 'es' ? '(procesado)' : '(processed)'), rendered: Boolean(output.rendered) };
}

async function runAgentTurn(input, state, ui, options = {}) {
  const signal = options.signal;
  state.turnCount += 1;
  state.__toolNameShown = false;
  if (state.turnCount === 1 && state.title === 'New session') {
    state.title = shortText(input, 60) || state.title;
  }

  const turnLanguage = detectLanguage(input, state.language);

  const directAction = parseDirectAction(input);
  if (directAction) {
    await appendTranscriptEntry(state.sessionId, { type: 'user', content: input });
    const result = await executeToolCall(directAction, state, ui, { signal });
    const cleanResult = stripBase64Images(String(result || ''));
    await appendTranscriptEntry(state.sessionId, { type: 'tool', tool: directAction.tool, args: directAction.args, result: cleanResult });
    const answer = await answerFromToolResult(input, directAction, cleanResult, state, ui, turnLanguage, signal);
    const finalAnswer = answer.content;
    state.history.push({ role: 'user', content: input }, { role: 'assistant', content: finalAnswer });
    await appendTranscriptEntry(state.sessionId, { type: 'assistant', content: finalAnswer });
    await persistSessionState(state, ui);
    return { content: finalAnswer, rendered: answer.rendered };
  }

  const turnMessages = [{ role: 'user', content: input }];
  const recoveryMessages = [];
  await appendTranscriptEntry(state.sessionId, { type: 'user', content: input });

  let step = 0;
  let stalledSteps = 0;
  let awaitingCommentAction = false;
  let toolUsedThisTurn = false;
  const toolProgressGuard = new (require('./tool-budget').ToolProgressGuard)();
  const finishNoProgress = async (message) => {
    const content = message || (turnLanguage === 'es'
      ? 'Se detuvo este turno porque Zyn siguió intentando sin avanzar. El historial está conservado. Puedes pedir continuar con otra estrategia.'
      : 'Paused this turn after repeated attempts without progress. History is preserved. You can request another approach.');
    state.history.push(...turnMessages, { role: 'assistant', content });
    await appendTranscriptEntry(state.sessionId, { type: 'assistant', content });
    await persistSessionState(state, ui);
    return { content, rendered: false };
  };

  try {
  while (true) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const injected = typeof state.getQueuedMessages === 'function' ? state.getQueuedMessages() : [];
    for (const msg of injected) {
      turnMessages.push({ role: 'user', content: `INPUT_ADICIONAL:\n${msg}` });
    }

    truncateHistory(state);

    const messages = buildConversationMessages(
      state,
      [...turnMessages, ...recoveryMessages.splice(0)],
      buildSystemPrompt(state.cwd, state, { input, language: turnLanguage }),
    );

    const useStream = !!state.tuiConfirm;
    const raw = await requestModel(messages, state, ui, {
      label: step === 0 ? (state.language === 'es' ? 'Analizando' : 'Analyzing') : (state.language === 'es' ? `Paso ${step + 1}` : `Step ${step + 1}`),
      signal,
      streamOutput: useStream,
    });

    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const { answer: rawAnswer, usage: rawUsage, rendered: assistantRendered = false } = raw || {};
    if (rawUsage) {
      state.lastTokenUsage = rawUsage;
      if (typeof ui.setTokenUsage === 'function') ui.setTokenUsage(rawUsage);
    }
    let parsed = raw.parsed || parseAgentResponse(rawAnswer || '');

    if (!raw.commentsRendered && parsed._comments && parsed._comments.length > 0) {
      for (const comment of parsed._comments) {
        if (typeof ui.logEvent === 'function') {
          ui.logEvent(state, 'comment', comment);
        } else {
          console.log(`\n  › ${comment}`);
        }
      }
    }

    if (parsed.type === 'invalid') {
      if (++stalledSteps >= 3) return await finishNoProgress();
      recoveryMessages.push({ role: 'user', content: parsed.error });
      if (toolProgressGuard.observe({ tool: 'invalid_response', args: {} }, rawAnswer)) return await finishNoProgress();
      step++;
      continue;
    }

    if (parsed.type === 'comment') {
      if (awaitingCommentAction) {
        const content = turnLanguage === 'es'
          ? 'El modelo terminó su respuesta con un comentario y no envió una acción ni una respuesta final.'
          : 'The model ended with commentary without sending an action or a final answer.';
        return await finishNoProgress(content);
      }
      awaitingCommentAction = true;
      recoveryMessages.push({ role: 'assistant', content: JSON.stringify({ type: 'comment', content: parsed.content }) });
      recoveryMessages.push({ role: 'user', content: turnLanguage === 'es'
        ? 'Tu respuesta quedó incompleta. Envía una sola llamada de herramienta completa o una respuesta final. No envíes otro comentario.'
        : 'Your response was incomplete. Send one complete tool call or a final answer. Do not send another comment.' });
      step++;
      continue;
    }

    if (parsed.tool && !KNOWN_TOOLS.has(parsed.tool)) {
      if (++stalledSteps >= 3) return await finishNoProgress();
      const invalidToolMsg = turnLanguage === 'en'
        ? `The tool "${parsed.tool}" does not exist. Available tools: ${[...KNOWN_TOOLS].join(', ')}. Use ONE of these exact names.`
        : `La herramienta "${parsed.tool}" no existe. Herramientas disponibles: ${[...KNOWN_TOOLS].join(', ')}. Usa UNO de estos nombres exactos.`;
      recoveryMessages.push({ role: 'assistant', content: JSON.stringify({ type: 'tool', tool: parsed.tool, args: parsed.args }) });
      recoveryMessages.push({ role: 'user', content: invalidToolMsg });
      if (toolProgressGuard.observe(parsed, invalidToolMsg)) return await finishNoProgress();
      step++;
      continue;
    }

    if (parsed.type === 'final') {
      let safeContent = (parsed.content || '').trim() || '(respuesta vacía)';
      const lastTool = turnMessages.filter(m => m.role === 'assistant' && m.content?.includes('"type":"tool"')).pop();
      const isAfterAskUser = lastTool && lastTool.content?.includes('"tool":"ask_user"');
      if (isAfterAskUser && safeContent.length < 20) {
        const askUserResult = turnMessages.find(m => m.role === 'user' && m.content?.includes('TOOL_RESULT'));
        if (askUserResult) {
          const userResponse = askUserResult.content.replace('TOOL_RESULT\n', '').split('\n')[0];
          safeContent = turnLanguage === 'en'
            ? `The user has responded. Based on their answer "${userResponse}", here is the information:`
            : `El usuario ha respondido. Basado en su respuesta "${userResponse}", aquí está la información:`;
        }
      }
      turnMessages.push({ role: 'assistant', content: safeContent });
      state.history.push(...turnMessages);
      await appendTranscriptEntry(state.sessionId, { type: 'assistant', content: safeContent });
      await persistSessionState(state, ui);
      return { content: safeContent, rendered: Boolean(assistantRendered) };
    }

    turnMessages.push({ role: 'assistant', content: JSON.stringify({ type: 'tool', tool: parsed.tool, args: sanitizeArgsForModel(parsed) }) });

    try {
      toolUsedThisTurn = true;
      const result = await executeToolCall(parsed, state, ui, { signal });
      await appendTranscriptEntry(state.sessionId, { type: 'tool', tool: parsed.tool, args: parsed.args, result });
      turnMessages.push({ role: 'user', content: `TOOL_RESULT\n${buildToolResultMessage(parsed, result, turnLanguage)}` });
      stalledSteps = 0;
      awaitingCommentAction = false;
      if (toolProgressGuard.observe(parsed, result)) return await finishNoProgress();
    } catch (err) {
      if (err?.message === 'aborted' && signal?.aborted) {
        throw new Error('aborted');
      }
      ui.logEvent?.(state, 'error', (turnLanguage === 'es' ? 'Falló ' : 'Failed ') + parsed.tool, err.message);
      turnMessages.push({ role: 'user', content: buildToolErrorMessage(parsed, err.message, turnLanguage) });
      if (++stalledSteps >= 3) return await finishNoProgress();
    }

    step++;
    const maxSteps = getSetting(state, 'maxToolSteps');
    if (require('./tool-budget').isToolStepLimitReached(step, maxSteps)) {
      const limitMsg = turnLanguage === 'es' ? 'Limite de pasos alcanzado. Resumiendo estado actual del sistema.' : 'Step limit reached. Summarizing current system state.';
      state.history.push(...turnMessages, { role: 'assistant', content: limitMsg });
      await persistSessionState(state, ui);
      return { content: limitMsg, rendered: false };
    }
  }
  } catch (err) {
    state.history.push(...turnMessages);
    await persistSessionState(state, ui);
    throw err;
  }
}

module.exports = { runAgentTurn, autoCompact };
