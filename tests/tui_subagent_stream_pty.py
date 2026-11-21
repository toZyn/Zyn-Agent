import unittest
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
                        self.assertIn('AGENT',screen)
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

if __name__=='__main__':unittest.main(verbosity=2)
