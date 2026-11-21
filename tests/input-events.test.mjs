import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInputEvent } from '../src/tui/input-events.mjs';

test('individual Enter submits without inserting a newline', () => {
  assert.deepEqual(normalizeInputEvent('\r', { return: true }), { text: '', submit: true, paste: false });
});

test('rapid text and Enter in one event submits the text', () => {
  assert.deepEqual(normalizeInputEvent('/exit\r', {}), { text: '/exit', submit: true, paste: true });
  assert.deepEqual(normalizeInputEvent('/help\n', {}), { text: '/help', submit: true, paste: true });
});

test('bracketed multiline paste is inserted without submitting', () => {
  assert.deepEqual(normalizeInputEvent('\x1b[200~hello\nworld\x1b[201~', {}), { text: 'hello world', submit: false, paste: true });
});

test('control sequences and newline chunks cannot inject control characters', () => {
  assert.deepEqual(normalizeInputEvent('\x1b[31mhi\x1b[0m\r', {}), { text: 'hi', submit: true, paste: true });
  assert.deepEqual(normalizeInputEvent('a\r\nb\r', {}), { text: 'a b', submit: true, paste: true });
});

test('plain typed characters are not treated as paste', () => {
  assert.deepEqual(normalizeInputEvent('a', {}), { text: 'a', submit: false, paste: false });
});

test('backspace at the beginning does not clear the whole draft', async () => {
  const { editDelete } = await import('../src/tui/input-events.mjs');
  assert.deepEqual(editDelete('abcdef', 0, 'backward'), { value: 'abcdef', cursor: 0 });
});

test('backspace and delete have different directions', async () => {
  const { editDelete } = await import('../src/tui/input-events.mjs');
  assert.deepEqual(editDelete('abcdef', 3, 'backward'), { value: 'abdef', cursor: 2 });
  assert.deepEqual(editDelete('abcdef', 3, 'forward'), { value: 'abcef', cursor: 3 });
});

test('Unicode editing preserves complete characters', async () => {
  const { editDelete, moveCursor } = await import('../src/tui/input-events.mjs');
  assert.equal(moveCursor('A😀B', 3, -1), 1);
  assert.deepEqual(editDelete('A😀B', 3, 'backward'), { value: 'AB', cursor: 1 });
});

test('multiple coalesced Return events remain distinct submissions', async () => {
  const { splitSubmittedInput } = await import('../src/tui/input-events.mjs');
  assert.deepEqual(splitSubmittedInput('/theme dark\r/exit\r', {}), { complete: ['/theme dark', '/exit'], rest: '' });
  assert.deepEqual(splitSubmittedInput('/help\r/settings', {}), { complete: ['/help'], rest: '/settings' });
});

test('bracketed paste never becomes multiple submitted commands', async () => {
  const { splitSubmittedInput } = await import('../src/tui/input-events.mjs');
  assert.equal(splitSubmittedInput('\x1b[200~/help\n/exit\x1b[201~', {}), null);
});

test('SGR mouse wheel input parses up/down without interpreting clicks as scroll', async () => {
  const { mouseWheelSteps } = await import('../src/tui/input-events.mjs');
  assert.equal(mouseWheelSteps('\x1b[<64;12;4M'), 1);
  assert.equal(mouseWheelSteps('\x1b[<65;12;4M'), -1);
  assert.equal(mouseWheelSteps('\x1b[<65;12;4M\x1b[<65;12;4M'), -2);
  assert.equal(mouseWheelSteps('\x1b[<0;12;4M'), 0);
});
