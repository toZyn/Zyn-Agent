import re
import time
import unittest
from tui_pty import Terminal

class FloodTests(unittest.TestCase):
    def test_five_thousand_messages_with_resize_and_scroll(self):
        term = Terminal(cols=85, rows=24, command=['node', 'tests/tui_flood.mjs'], env_extra={'ZYN_FLOOD_MESSAGES': '5000'})
        try:
            deadline = time.monotonic() + 35
            while b'FLOOD_READY' not in term.capture and time.monotonic() < deadline and term.proc.poll() is None:
                term.read(0.2)
            self.assertIn(b'FLOOD_READY', term.capture)
            self.assertIn(b'count=5000', term.capture)
            self.assertEqual(term.capture.count(b'\x1b[2J'), 0)
            term.resize(30, 16)
            for _ in range(8): term.send(b'\x1b[5~', 0.03)
            self.assertIn('Older messages', term.text)
            term.resize(100, 35)
            for _ in range(8): term.send(b'\x1b[6~', 0.03)
            term.send(b'\x03', 0.25)
            self.assertEqual(term.wait_exit(), 0)
        finally:
            term.close()

    def test_real_rendering_with_many_messages_and_navigation(self):
        term = Terminal(cols=80, rows=24, command=['node', 'tests/tui_flood.mjs'])
        try:
            deadline = time.monotonic() + 18
            while b'FLOOD_READY' not in term.capture and time.monotonic() < deadline and term.proc.poll() is None:
                term.read(0.2)
            self.assertIn(b'FLOOD_READY', term.capture)
            self.assertIsNone(term.proc.poll())
            self.assertEqual(term.capture.count(b'\x1b[2J'), 0, 'full screen clear causes visible flashing')
            start = len(term.capture)
            term.send(b'\x1b[5~', 0.2)
            self.assertIn(b'Older messages', term.capture[start:])
            start = len(term.capture)
            term.send(b'\x1b[6~', 0.2)
            self.assertNotIn('Older messages', term.text[-420:])
            start = len(term.capture)
            term.send(b'\x1b[<64;20;7M', 0.2)
            self.assertIn(b'Older messages', term.capture[start:])
            self.assertIsNone(term.proc.poll())
            start = len(term.capture)
            term.send(b'\x1b[<65;20;7M', 0.2)
            self.assertNotIn('Older messages', term.text[-420:])
            term.send(b'\x03', 0.2)
            self.assertEqual(term.wait_exit(), 0)
        finally:
            term.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
