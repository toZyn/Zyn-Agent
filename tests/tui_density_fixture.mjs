import React from 'react';
import { render } from 'ink';
import { App } from '../src/tui/app.mjs';
import { UIStore } from '../src/tui/store.mjs';

const store = new UIStore();
const state = { activeModel: 'zyncloud-minimax-m3', cwd: process.cwd(), language: 'en', settings: {}, turnCount: 0 };
store.addItem({ type: 'banner', model: 'minimax-m3', resumed: false, cwd: process.cwd() });
for (let i = 0; i < 480; i++) {
  store.addItem({ type: 'user', text: `Q_${i}: explain the next step` });
  store.addItem({ type: 'answer', text: `A_${i}: answer with complete context and a safe example.` });
  if (i % 8 === 0) store.addEvent('ok', `Completed tool ${i}`, 'Exit code: 0\nSTDOUT: ' + 'X'.repeat(360));
}
store.addItem({ type: 'user', text: 'LAST_USER_MARKER' });
store.addItem({ type: 'answer', text: 'LAST_ANSWER_MARKER' });
const app = render(React.createElement(App, { store, state, onSubmit: () => {} }), { exitOnCtrlC: false, interactive: true });
await app.waitUntilExit();
