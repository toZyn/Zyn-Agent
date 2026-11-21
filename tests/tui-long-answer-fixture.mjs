import React from 'react';
import { render } from 'ink';
import { App } from '../src/tui/app.mjs';
import { UIStore } from '../src/tui/store.mjs';
const store = new UIStore();
store.addItem({ type: 'answer', text: Array.from({ length: 100 }, (_, i) => `LINE_${String(i).padStart(3, '0')} Texto **completo** y ordenado.`).join('\n\n') });
const state = { language: 'en', settings: {}, activeModel: 'zyncloud-minimax-m3' };
const app = render(React.createElement(App, { store, state, onSubmit() {} }), { exitOnCtrlC: false, interactive: true });
await app.waitUntilExit();
