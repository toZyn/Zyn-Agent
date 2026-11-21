import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutForWidth } from '../src/tui/layout.mjs';

test('30-column terminals do not force a wider banner or input', () => {
  const layout = layoutForWidth(30);
  assert.equal(layout.frameWidth, 28);
  assert.equal(layout.compact, true);
  assert.ok(layout.frameWidth + 1 <= layout.columns);
  assert.ok(layout.inputColumns > 0 && layout.inputColumns < layout.columns);
});

test('normal terminals keep a bounded readable banner', () => {
  assert.equal(layoutForWidth(80).frameWidth, 72);
  assert.equal(layoutForWidth(250).frameWidth, 72);
  assert.equal(layoutForWidth(80).compact, false);
});

test('extremely small and invalid dimensions never produce negative widths', () => {
  for (const width of [0, 1, 8, 12, NaN, -20]) {
    const layout = layoutForWidth(width);
    assert.ok(layout.columns >= 1);
    assert.ok(layout.frameWidth >= 0);
    assert.ok(layout.inputColumns >= 1);
    assert.ok(layout.statusWidth >= 1);
  }
});
