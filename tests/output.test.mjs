import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSystemOutput } from '../src/tui/output.mjs';

test('large command output can be scrolled in smaller independent entries', () => {
  const content = Array.from({length: 130},(_,i)=>`help line ${i}`).join('\n');
  const pieces = splitSystemOutput(content, 5);
  assert.equal(pieces.length, 26);
  assert.equal(pieces.map(piece => piece.text).join('\n'), content);
  assert.equal(pieces[0].type, 'system');
});
