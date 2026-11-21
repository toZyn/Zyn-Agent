import React from 'react';
import { render } from 'ink';
import { App } from '../src/tui/app.mjs';
import { UIStore } from '../src/tui/store.mjs';

const store = new UIStore();
const state = { language: 'en', settings: {}, activeModel: 'zyncloud-minimax-m3' };
const app = render(React.createElement(App, { store, state, onSubmit: () => {} }), { exitOnCtrlC: false, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
const iterations = Math.max(1200, Math.min(20000, Number(process.env.ZYN_FLOOD_MESSAGES) || 1200));
const began = performance.now();
for (let i = 0; i < iterations; i++) {
  const role = i % 2 === 0 ? 'user' : 'answer';
  const text = `[${String(i).padStart(4, '0')}] ${role} load test: ` + (i % 17 === 0 ? 'Very long line to exercise wrapping. '.repeat(15) : 'short response');
  store.addItem({ type: role, text });
  if (i % 15 === 0) await new Promise(resolve => setTimeout(resolve, 16));
}
store.beginAnswer();
for (let i = 0; i < 50; i++) {
  store.appendAnswer(`chunk${i} `);
  await new Promise(resolve => setTimeout(resolve, 3));
}
store.endAnswer();
await new Promise(resolve => setTimeout(resolve, 400));
process.stderr.write(`FLOOD_READY count=${iterations} duration_ms=${Math.round(performance.now() - began)} visible=${store.items.length} rss_mb=${Math.round(process.memoryUsage().rss / 1048576)}\n`);
await app.waitUntilExit();
