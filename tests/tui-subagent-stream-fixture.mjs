import React from 'react';
import { render } from 'ink';
import { App } from '../src/tui/app.mjs';
import { UIStore } from '../src/tui/store.mjs';

const store = new UIStore();
const state = { activeModel: 'zyncloud-minimax-m3', cwd: process.cwd(), language: 'en', settings: {}, turnCount: 1 };
store.addItem({ type: 'banner', model: 'minimax-m3', resumed: false, cwd: process.cwd() });
store.addItem({ type: 'user', text: 'Ask a subagent to check RAM and free disk space.' });
store.addEvent('tool', 'Preparing spawn_agent', '');
setTimeout(() => store.addEvent('ok', 'Completed spawn_agent', JSON.stringify({
  agent_id: 'b4f231bf-e618-47cd-a9b7-61415440db02', role: 'general', status: 'running',
  task: 'Read memory and storage', result: null,
})), 110);
setTimeout(() => store.addEvent('tool', 'Preparing wait_agent', ''), 220);
setTimeout(() => store.addEvent('ok', 'Completed wait_agent', JSON.stringify({
  agent_id: 'b4f231bf-e618-47cd-a9b7-61415440db02', role: 'general', status: 'completed',
  task: 'Read memory and storage', result: 'RAM 3.7 GiB and disk 109 GB',
})), 320);
setTimeout(() => store.beginAnswer(), 370);
const chunks = [
  '## System resources\n',
  'Memory RAM\n- Total: 3.7 GiB\n- Available: 1.3 GiB\n',
  '\nStorage\nPartición │ Total │ Usado │ Disponible │ Uso\n',
  '/ │ 109 GB │ 30 GB │ 79 GB │ 28 %\n',
];
chunks.forEach((chunk, index) => setTimeout(() => store.appendAnswer(chunk), 430 + index * 80));
setTimeout(() => store.endAnswer(), 810);
const app = render(React.createElement(App, { store, state, onSubmit: () => {} }), { exitOnCtrlC: false, interactive: true });
await app.waitUntilExit();
