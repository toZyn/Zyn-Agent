import fcntl
import os
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANSI = re.compile(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[PX^_].*?\x1b\\)', re.S)


class Terminal:
    def __init__(self, cols=80, rows=24, command=None, env_extra=None):
        self.tmp = tempfile.TemporaryDirectory(prefix='zyn-tui-test-')
        self.master, slave = pty.openpty()
        self._winsize(slave, cols, rows)
        env = os.environ.copy()
        env.pop('NO_COLOR', None)
        env.pop('FORCE_COLOR', None)
        env.update({'TERM': 'xterm-256color', 'ZYN_DATA_DIR': self.tmp.name})
        if env_extra: env.update(env_extra)
        self.proc = subprocess.Popen(command or ['node', 'zyn.js'], cwd=ROOT, stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
        os.close(slave)
        self.capture = bytearray()
        self.read(0.3)
        deadline = time.monotonic() + 6
        while b'\xe2\x9d\xaf' not in self.capture and self.proc.poll() is None and time.monotonic() < deadline:
            self.read(0.1)

    def _winsize(self, fd, cols, rows):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def read(self, duration):
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            try:
                ready, _, _ = select.select([self.master], [], [], min(0.05, max(0, deadline - time.monotonic())))
                if ready:
                    data = os.read(self.master, 65536)
                    if not data:
                        break
                    self.capture.extend(data)
            except (OSError, ValueError):
                break

    def send(self, content, duration=0.25):
        if self.proc.poll() is not None:
            raise AssertionError('TUI exited prematurely')
        os.write(self.master, content)
        self.read(duration)

    def resize(self, cols, rows):
        self._winsize(self.master, cols, rows)
        os.killpg(self.proc.pid, signal.SIGWINCH)
        self.read(0.2)

    @property
    def text(self):
        return ANSI.sub('', self.capture.decode('utf-8', 'replace')).replace('\r', '')

    def wait_exit(self, timeout=2):
        try:
            result = self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            raise AssertionError('TUI did not exit') from error
        self.read(0.1)
        return result

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=1)
        os.close(self.master)
        self.tmp.cleanup()


class TuiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.term = Terminal()

    def tearDown(self):
        self.term.close()

    def test_combined_exit_and_enter(self):
        self.term.send(b'/exit\r', 0.25)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_help_and_exit_in_rapid_events(self):
        self.term.send(b'/help\r', 0.6)
        self.assertIn('zyncloud', self.term.text.lower())
        self.term.send(b'/exit\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_bracketed_paste_stays_in_draft_until_enter(self):
        self.term.send(b'\x1b[200~/exit\x1b[201~', 0.2)
        self.assertIsNone(self.term.proc.poll())
        self.term.send(b'\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_narrow_terminal_and_menu_cancel(self):
        self.term.resize(30, 16)
        self.term.send(b'/theme\r', 0.5)
        self.assertIn('Select Theme', self.term.text)
        self.term.send(b'\x1b', 0.3)
        self.term.send(b'/exit\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)
        self.assertTrue(any('┌' in line and len(line) <= 30 for line in self.term.text.splitlines()))

    def test_very_small_terminal_can_quit(self):
        self.term.resize(12, 12)
        self.term.send(b'/exit\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_large_draft_and_ctrl_c(self):
        self.term.send(b'x' * 10000, 0.3)
        self.assertIsNone(self.term.proc.poll())
        self.term.send(b'\x03', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_resize_repeatedly(self):
        for cols, rows in [(100, 40), (30, 16), (12, 12), (220, 55), (80, 24)]:
            self.term.resize(cols, rows)
            self.assertIsNone(self.term.proc.poll())
        self.term.send(b'/exit\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_multiple_picker_navigation_and_escape(self):
        for command in [b'/models\r', b'/providers\r', b'/settings\r', b'/sessions\r']:
            self.term.send(command, 0.4)
            self.assertIsNone(self.term.proc.poll())
            self.term.send(b'\x1b', 0.2)
        self.term.send(b'/exit\r', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_repeated_theme_switch_does_not_deadlock(self):
        for _ in range(12):
            self.term.send(b'/theme dark\r', 0.04)
            self.assertIsNone(self.term.proc.poll())
        self.term.send(b'/exit\r', 0.6)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_coalesced_commands_execute_separately(self):
        self.term.send(b'/theme dark\r/exit\r', 0.5)
        self.assertEqual(self.term.wait_exit(), 0)
        self.assertNotIn('unknown theme', self.term.text.lower())

    def test_double_escape_in_same_input_chunk(self):
        self.term.send(b'\x1b\x1b', 0.3)
        self.assertEqual(self.term.wait_exit(), 0)

    def test_double_escape_exits_without_crashing(self):
        self.term.send(b'\x1b', 0.1)
        self.term.send(b'\x1b', 0.2)
        self.assertEqual(self.term.wait_exit(), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
