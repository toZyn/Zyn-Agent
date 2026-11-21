import test from 'node:test';
import assert from 'node:assert/strict';
import { UIStore } from '../src/tui/store.mjs';
import { selectViewportItems } from '../src/tui/viewport.mjs';

const fakeItems = () => Array.from({ length: 1200 }, (_, i) => ({ type: 'event', id: String(i), title: `item-${i}`, detail: `detail-${i}` }));

test('viewport shows a bounded tail within a small terminal', () => {
  const result = selectViewportItems(fakeItems(), { columns: 50, rows: 14, offset: 0 });
  assert.equal(result.at(-1)?.id, '1199');
  assert.ok(result.length > 0 && result.length < 14);
});

test('scrolling pages exposes previous items and returns to most recent', () => {
  const store = new UIStore();
  for (const item of fakeItems()) store.addItem(item);
  const bottom = selectViewportItems(store.items, { columns: 50, rows: 12, offset: store.scrollOffset });
  store.scrollBy(12);
  const older = selectViewportItems(store.items, { columns: 50, rows: 12, offset: store.scrollOffset });
  assert.notEqual(bottom.at(-1)?.id, older.at(-1)?.id);
  store.scrollToBottom();
  assert.deepEqual(selectViewportItems(store.items, { columns: 50, rows: 12, offset: store.scrollOffset }), bottom);
});

test('new messages do not yank user to bottom while browsing older output', () => {
  const store = new UIStore();
  for (let i=0; i<40; i++) store.addItem({type:'event',title:String(i)});
  store.scrollBy(15);
  const anchor = store.items.at(-1 - store.scrollOffset).title;
  store.addItem({ type:'event',title:'new!' });
  assert.equal(store.items.at(-1-store.scrollOffset).title, anchor);
});

test('scroll position is clamped after many evictions', () => {
  const store = new UIStore();
  for (let i=0; i<1000; i++) store.addItem({type:'event',title:String(i)});
  store.scrollBy(Infinity);
  assert.ok(store.scrollOffset >= 0 && store.scrollOffset < store.items.length);
  for (let i=0; i<2000; i++) store.addItem({type:'event',title:String(i)});
  assert.ok(store.scrollOffset >= 0 && store.scrollOffset < store.items.length);
});
