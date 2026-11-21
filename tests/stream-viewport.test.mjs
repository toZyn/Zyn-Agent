import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleStreamTail } from '../src/tui/stream-viewport.mjs';

test('long streaming responses show the newest lines rather than clipping their end',()=>{
  const source=Array.from({length:240},(_,i)=>'record-'+String(i).padStart(3,'0')).join('\n');
  const visible=visibleStreamTail(source,32,7);
  assert.ok(visible.includes('record-239'));
  assert.ok(!visible.includes('record-000'));
  assert.equal(visible.split('\n').length,7);
  assert.equal(source.split('\n').length,240);
});

test('short responses remain intact across streamed updates',()=>{
  assert.equal(visibleStreamTail('A\nB\nC',64,10),'A\nB\nC');
  assert.equal(visibleStreamTail('',64,10),'');
});

test('multiple wrapped rows count towards the streaming viewport height',()=>{
  const source='A'.repeat(120)+'\nLatest entry';
  assert.equal(visibleStreamTail(source,20,3),'Latest entry');
});
