import test from 'node:test';
import assert from 'node:assert/strict';
import { UIStore } from '../src/tui/store.mjs';
import {prepareTranscriptLines, transcriptViewport} from '../src/tui/transcript-view.mjs';

test('transcript text is wrapped without terminal-control injection or hidden content',()=>{
 const lines=prepareTranscriptLines('tool\n'+('12345'.repeat(40))+'\n\x1b[2JSECRET',35);
 assert.ok(lines.every(line=>Array.from(line).length<=29));
 assert.equal(lines.join('').includes('\x1b'),false);
 assert.ok(lines.join('').includes('SECRET'));
 const reconstructed=lines.join('').replace(/\s/g,'');
 assert.ok(reconstructed.includes('12345'.repeat(40)));
});

test('transcript viewport scrolls the dedicated window and does not modify chat items',()=>{
 const store=new UIStore();
 store.addItem({type:'user',text:'hello'});
 const original=store.items.length;
 store.openTranscript(Array.from({length:30},(_,i)=>`row-${i}`));
 let view=transcriptViewport(store.transcriptView,45,16);
 assert.equal(view.lines.at(-1),'row-29');
 store.scrollTranscript(9);
 view=transcriptViewport(store.transcriptView,45,16);
 assert.notEqual(view.lines.at(-1),'row-29');
 assert.equal(store.items.length,original);
 store.closeTranscript();
 assert.equal(store.transcriptView,null);
 assert.equal(store.items.length,original);
});

test('structured tool records expose identity and outcome within narrow columns',async()=>{
 const {prepareTranscriptEntryLines}=await import('../src/tui/transcript-view.mjs');
 const records=[{type:'tool',at:'2026-11-21T00:00:17Z',tool:'web_search',args:{query:'new tech'},result:'TRACE_17 '+('X'.repeat(2500))}];
 const rows=prepareTranscriptEntryLines(records,30);
 assert.ok(rows.some(line=>line.includes('web_search')));
 assert.ok(rows.some(line=>line.includes('TRACE_17')));
 assert.ok(rows.every(line=>Array.from(line).length<=24));
 assert.ok(rows.length<=5);
 assert.ok(rows.join('\n').length<125);
});
