import unittest
import pyte
from tui_pty import Terminal

def screen(term, cols, rows):
    view = pyte.Screen(cols, rows)
    pyte.Stream(view).feed(term.capture.decode('utf8', 'replace'))
    return '\n'.join(view.display)

class LongAnswerTests(unittest.TestCase):
    def test_single_long_answer_scrolls_to_both_ends_and_resizes(self):
        term = Terminal(cols=42, rows=18, command=['node', 'tests/tui-long-answer-fixture.mjs'])
        try:
            term.read(0.3)
            self.assertIn('LINE_099', screen(term, 42, 18))
            term.send(b'\x1b[1;5H', 0.4)
            self.assertIn('LINE_000', screen(term, 42, 18))
            term.resize(80, 26)
            term.send(b'\x1b[1;5F', 0.3)
            for _ in range(30):
                term.send(b'\x1b[6~', 0.02)
            result = screen(term, 80, 26)
            self.assertIn('LINE_099', result)
            self.assertIn('Texto completo y ordenado.', result)
            self.assertIn('Type a message', result)
            self.assertNotIn('**', result)
            term.send(b'\x03', 0.2)
            self.assertEqual(term.wait_exit(), 0)
        finally:
            term.close()
