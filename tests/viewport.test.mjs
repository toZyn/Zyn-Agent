import test from 'node:test';
import assert from 'node:assert/strict';
import { appendVisibleItem } from '../src/tui/viewport.mjs';

test('a long interactive session keeps bounded rendered items in order', () => {
  let items = [];
  for (let i = 0; i < 10000; i++) items = appendVisibleItem(items, { id: i }, 400);
  assert.equal(items.length, 400);
  assert.equal(items[0].id, 9600);
  assert.equal(items.at(-1).id, 9999);
});

test('invalid configuration cannot grow UI history without bound', () => {
  assert.equal(appendVisibleItem([], { id: 1 }, Infinity).length, 1);
  assert.equal(appendVisibleItem([], { id: 1 }, -20).length, 1);
});
