const originalFetch = global.fetch;
const tool = (name, args) => JSON.stringify({ type: 'tool', tool: name, args });
const final = content => JSON.stringify({ type: 'final', content });
const content = '## Recomendaciones\n\n| Modelo | Uso recomendado |\n| --- | --- |\n| **Qwen2.5 0.5B Instruct** | Conversación y tareas básicas sin perder este texto largo |\n\n1. **Qwen2.5 0.5B Instruct — Q4_K_M**\n   - Adecuado para conversación simple.\n2. **Qwen3 0.6B — Q4_K_M**\n   - Alternativa compacta.\n3. **Llama 3.2 1B Instruct — Q4_K_M**\n   - Necesita contexto pequeño.\n\nDisponible: **1.3 GiB**. Disco: **79 GB**.\n\nRuta literal: `C:\\new\\test`.\n\nRESULTADO_FINAL_UNICO';
global.fetch = async (input, options) => {
  const url = String(input);
  if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ models: [{ slug: 'hardware-stream-fixture', display_name: 'Hardware test', visibility: 'list' }] }));
  if (!url.endsWith('/v1/responses')) return originalFetch(input, options);
  const request = JSON.parse(options.body);
  const messages = request.input || [];
  const child = messages.some(message => message.role === 'user' && /^CHILD_FIXTURE/.test(message.content));
  const actions = messages.filter(message => message.role === 'assistant').flatMap(message => {
    try { const value = JSON.parse(message.content); return value.type === 'tool' ? [value] : []; } catch { return []; }
  });
  const last = actions.at(-1);
  const questions = messages.some(message => message.role === 'user' && message.content.startsWith('Preguntas fixture'));
  let blocks;
  if (child) blocks = [{ channel: 'final', text: final('CHILD_OK: revisión completada.') }];
  else if (!last && questions) blocks = [{ channel: 'commentary', text: 'Prepararé preguntas con un subagente.' }, { channel: 'final', text: tool('ask_user', { question: 'Elige un tema', options: ['Videojuegos', 'Programación'] }) }];
  else if (!last) blocks = [
    { channel: 'commentary', text: 'Revisaré **RAM y CPU**. COMENTARIO_EN_VIVO' },
    { channel: 'commentary', text: 'Después revisaré almacenamiento.' },
    { channel: 'final', text: tool('run_command', { command: "printf 'HARDWARE_OK'" }) },
  ];
  else if (['run_command', 'ask_user'].includes(last.tool)) blocks = [{ channel: 'final', text: JSON.stringify({ type: 'comment', content: 'Voy a crear el subagente de revisión.' }, null, 2) + '\n\n' + tool('spawn_agent', { task: 'CHILD_FIXTURE: revisa el informe sin modificar archivos', role: 'review' }) }];
  else if (last.tool === 'spawn_agent') {
    const result = messages.filter(message => message.role === 'user').at(-1)?.content || '';
    const id = result.match(/"agent_id"\s*:\s*"([^"]+)"/)?.[1];
    if (!id) throw new Error('Fixture expected an actual spawned agent ID');
    blocks = [{ channel: 'final', text: 'Esperaré el resultado del subagente.\n' + tool('wait_agent', { agent_id: id, timeout_ms: 5000 }) }];
  } else blocks = [{ channel: 'final', text: final(questions ? '1. ¿Cuál es tu videojuego favorito?\n   - Puedes elegir cualquiera.\n2. ¿Qué personaje prefieres?\n3. ¿Qué cambiarías de ese juego?\n\nPREGUNTAS_LISTAS' : content) }];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = event => controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
      for (const [index, block] of blocks.entries()) {
        const id = 'item_' + index;
        emit({ type: 'response.output_item.added', output_index: index, item: { type: 'message', id, role: 'assistant', channel: block.channel, status: 'in_progress', content: [] } });
        for (let i = 0; i < block.text.length; i += 9) {
          emit({ type: 'response.output_text.delta', item_id: id, output_index: index, content_index: 0, delta: block.text.slice(i, i + 9) });
          await new Promise(resolve => setTimeout(resolve, child ? 1 : 7));
        }
        emit({ type: 'response.output_item.done', output_index: index, item: { type: 'message', id, role: 'assistant', channel: block.channel, status: 'completed', content: [{ type: 'output_text', text: block.text }] } });
      }
      emit({ type: 'response.completed', response: { usage: { input_tokens: 123, output_tokens: 456, total_tokens: 579 } } });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
};
