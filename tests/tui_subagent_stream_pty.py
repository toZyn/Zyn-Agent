import unittest
import time
from tui_pty import Terminal
try:
    import pyte
except ImportError:
    pyte=None

def snapshot(term,cols,rows):
    screen=pyte.Screen(cols,rows)
    pyte.Stream(screen).feed(term.capture.decode('utf-8','replace'))
    return [line.rstrip() for line in screen.display]

class StreamingAgentVisualTests(unittest.TestCase):
    @unittest.skipUnless(pyte,'pyte optional visual terminal dependency')
    def test_agent_progress_is_structured_without_raw_json_or_interleaved_table(self):
        for cols,rows in [(48,24),(62,28),(90,32)]:
            with self.subTest(cols=cols,rows=rows):
                term=Terminal(cols=cols,rows=rows,command=['node','tests/tui-subagent-stream-fixture.mjs'],wait_ready=False)
                try:
                    term.read(1.3)
                    lines=snapshot(term,cols,rows)
                    screen='\n'.join(lines)
                    if cols >= 62:
                        self.assertNotIn('AGENT',screen)
                        self.assertIn('general',screen)
                        self.assertIn('completed',screen)
                    self.assertNotIn('"agent_id"',screen)
                    self.assertNotIn('Storageable',screen)
                    self.assertIn('79 GB',screen)
                    self.assertIn('3.7 GiB',screen)
                    self.assertIn('Type a message',screen)
                    self.assertNotIn('Preparing spawn_agent',screen)
                    self.assertNotIn('Preparing wait_agent',screen)
                    term.send(b'\x03',0.2)
                    self.assertEqual(term.wait_exit(),0)
                finally:term.close()

    @unittest.skipUnless(pyte,'pyte optional visual terminal dependency')
    def test_subagent_result_and_partial_answer_survive_resize_while_streaming(self):
        term=Terminal(cols=62,rows=28,command=['node','tests/tui-subagent-stream-fixture.mjs'],env_extra={'ZYN_STREAM_TEST_SLOWDOWN':'4'},wait_ready=False)
        try:
            def await_screen(cols,rows,predicate):
                deadline=time.monotonic()+6
                while time.monotonic()<deadline:
                    current='\n'.join(snapshot(term,cols,rows))
                    if predicate(current): return current
                    term.read(0.05)
                self.fail('Expected streaming phase was not reached: '+current)
            partial=await_screen(62,28,lambda text:'3.7 GiB' in text and '▎' in text)
            self.assertIn('3.7 GiB',partial)
            self.assertIn('▎',partial)
            self.assertIn('completed',partial)
            self.assertNotIn('AGENT',partial)
            term.resize(48,24)
            narrow=await_screen(48,24,lambda text:'79 GB' in text and '▎' in text)
            self.assertIn('79 GB',narrow)
            self.assertIn('3.7 GiB',narrow)
            self.assertIn('Type a message',narrow)
            self.assertNotIn('Storageable',narrow)
            term.resize(90,32)
            final=await_screen(90,32,lambda text:'79 GB' in text and '▎' not in text)
            self.assertIn('general',final)
            self.assertIn('completed',final)
            self.assertIn('79 GB',final)
            self.assertIn('3.7 GiB',final)
            self.assertNotIn('▎',final)
            self.assertNotIn('"agent_id"',final)
            self.assertEqual(term.capture.count(b'\x1b[2J'),0)
            term.send(b'\x03',0.2)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

if __name__=='__main__':unittest.main(verbosity=2)
