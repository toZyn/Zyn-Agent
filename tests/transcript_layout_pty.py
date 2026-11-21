import json
import unittest
from pathlib import Path
from tui_pty import Terminal

try:
    import pyte
except ImportError:
    pyte=None

def snapshot(term,columns,rows):
    screen=pyte.Screen(columns,rows)
    stream=pyte.Stream(screen)
    stream.feed(term.capture.decode('utf8','replace'))
    return [line.rstrip() for line in screen.display]

class TranscriptLayoutTests(unittest.TestCase):
    @unittest.skipUnless(pyte,'pyte optional visual snapshot dependency')
    def test_initial_header_is_near_top_instead_of_row_15(self):
        term=Terminal(cols=64,rows=26)
        try:
            lines=snapshot(term,64,26)
            self.assertTrue(any('Zyn' in line for line in lines[:7]),[(i,x) for i,x in enumerate(lines) if x.strip()])
            term.send(b'/exit\r',0.2)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    @unittest.skipUnless(pyte,'pyte optional visual snapshot dependency')
    def test_transcript_uses_separate_scroll_view_and_returns_cleanly(self):
        cols,rows=64,26
        term=Terminal(cols=cols,rows=rows)
        try:
            base=Path(term.tmp.name)/'chat'
            session=json.loads((base/'current-session.json').read_text())['sessionId']
            (base/'transcripts').mkdir(exist_ok=True)
            records=[{'at':f'2026-11-21T00:00:{i:02d}Z','type':'tool','tool':'web_search','args':{'query':'x'*40},'result':f'RESULT-{i} '+('ABCDEF '*25)} for i in range(18)]
            (base/'transcripts'/f'{session}.jsonl').write_text('\n'.join(json.dumps(x) for x in records)+'\n')
            term.send(b'/transcript\r',0.6)
            screen=snapshot(term,cols,rows)
            self.assertTrue(any('Transcript' in x for x in screen[:5]),screen)
            self.assertTrue(any('Esc' in x for x in screen[-5:]),screen)
            term.send(b'\x1b[A',0.2)
            term.send(b'\x1b',0.3)
            clean=snapshot(term,cols,rows)
            self.assertFalse(any('RESULT-' in line for line in clean),clean)
            self.assertTrue(any('Type a message' in line for line in clean[-8:]),clean)
            self.assertNotIn(b'\x1b[2J',term.capture)
            term.send(b'/exit\r',0.2)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()


    @unittest.skipUnless(pyte,'pyte optional visual snapshot dependency')
    def test_transcript_view_works_on_multiple_mobile_terminal_sizes(self):
        for cols,rows in [(30,14),(44,18),(64,26),(90,32)]:
            with self.subTest(columns=cols,rows=rows):
                term=Terminal(cols=cols,rows=rows)
                try:
                    base=Path(term.tmp.name)/'chat'
                    session=json.loads((base/'current-session.json').read_text())['sessionId']
                    (base/'transcripts').mkdir(exist_ok=True)
                    entries=[{'at':f'2026-11-21T00:00:{i:02d}Z','type':'tool','tool':'read_file','args':{'path':f'file-{i}.txt'},'result':f'TRACE_{i:02d}'+('ABCDEFGHIJK '*15)} for i in range(30)]
                    (base/'transcripts'/f'{session}.jsonl').write_text('\n'.join(json.dumps(x) for x in entries)+'\n')
                    term.send(b'/transcript\r',0.45)
                    before=snapshot(term,cols,rows)
                    self.assertIn('Transcript','\n'.join(before))
                    self.assertIn('Esc','\n'.join(before[-7:]))
                    self.assertTrue(any('TRACE_' in line for line in before))
                    term.send(b'\x1b[5~',0.25)
                    after=snapshot(term,cols,rows)
                    self.assertNotEqual(before,after)
                    term.send(b'\x1b',0.3)
                    closed=snapshot(term,cols,rows)
                    self.assertTrue(any('Type a message' in line for line in closed))
                    self.assertFalse(any('TRACE_' in line for line in closed))
                    term.send(b'/exit\r',0.2)
                    self.assertEqual(term.wait_exit(),0)
                finally:term.close()

    @unittest.skipUnless(pyte,'pyte optional visual snapshot dependency')
    def test_flooded_history_preserves_input_and_scroll_anchors(self):
        for cols,rows in [(30,16),(52,22),(80,32)]:
            with self.subTest(columns=cols,rows=rows):
                term=Terminal(cols=cols,rows=rows,command=['node','tests/tui_density_fixture.mjs'],wait_ready=False)
                try:
                    term.read(0.6)
                    current=snapshot(term,cols,rows)
                    self.assertTrue(any('LAST_' in line for line in current),current)
                    self.assertTrue(any('Type a message' in line for line in current[-8:]),current)
                    term.send(b'\x1b[5~',0.3)
                    older=snapshot(term,cols,rows)
                    self.assertNotEqual(older,current)
                    term.send(b'\x1b[6~',0.3)
                    bottom=snapshot(term,cols,rows)
                    self.assertTrue(any('LAST_' in line for line in bottom),bottom)
                    self.assertNotIn(b'\x1b[2J',term.capture)
                    term.send(b'\x03',0.2)
                    self.assertEqual(term.wait_exit(),0)
                finally:term.close()

    @unittest.skipUnless(pyte,'pyte optional visual snapshot dependency')
    def test_transcript_resizes_without_losing_controls_or_leaking_content(self):
        term=Terminal(cols=64,rows=26)
        try:
            base=Path(term.tmp.name)/'chat'
            session=json.loads((base/'current-session.json').read_text())['sessionId']
            (base/'transcripts').mkdir(exist_ok=True)
            records=[{'at':f'2026-11-21T00:00:{i:02d}Z','type':'tool','tool':'read_file','args':{'path':f'file-{i}'},'result':'DETAIL_'+str(i)+' '+('Z'*100)} for i in range(25)]
            (base/'transcripts'/f'{session}.jsonl').write_text('\n'.join(json.dumps(r) for r in records)+'\n')
            term.send(b'/transcript\r',0.35)
            for cols,rows in [(30,16),(90,30),(46,18)]:
                term.resize(cols,rows)
                term.read(0.2)
                screen=snapshot(term,cols,rows)
                self.assertTrue(any('Transcript' in line for line in screen[:3]),screen)
                self.assertTrue(any('Esc' in line for line in screen[-8:]),screen)
            term.send(b'\x1b',0.35)
            final=snapshot(term,46,18)
            self.assertTrue(any('Type a message' in line for line in final),final)
            self.assertFalse(any('DETAIL_' in line for line in final),final)
            term.send(b'/exit\r',0.2)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

if __name__=='__main__': unittest.main(verbosity=2)
