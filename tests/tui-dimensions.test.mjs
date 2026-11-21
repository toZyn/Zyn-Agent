import test from 'node:test';
import assert from 'node:assert/strict';
import { readTerminalDimensions } from '../src/tui/dimensions.mjs';

test('live TTY ioctl dimensions override stale stdout row properties', () => {
  const out = { columns: 64, rows: 18, getWindowSize: () => [64, 31] };
  assert.deepEqual(readTerminalDimensions(out, {}), { width: 64, height: 31 });
  out.getWindowSize = () => [64, 20];
  assert.equal(readTerminalDimensions(out, {}).height, 20);
});

test('manual height override is bounded and optional', () => {
  const tty = { columns: 32, rows: 19, getWindowSize: () => [32, 19] };
  assert.deepEqual(readTerminalDimensions(tty, { ZYN_TUI_ROWS: '36' }), { width: 32, height: 36 });
  assert.equal(readTerminalDimensions(tty, { ZYN_TUI_ROWS: '5000' }).height, 19);
  assert.deepEqual(readTerminalDimensions({ columns: 0, rows: 0, getWindowSize: () => { throw Error('tty not ready'); } }, {}), { width: 100, height: 40 });
});
