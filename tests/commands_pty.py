import unittest
from tui_pty import Terminal

class CommandIntegrationTests(unittest.TestCase):
    def test_essential_commands_work_in_real_ink_terminal_without_model_calls(self):
        terminal = Terminal(cols=90,rows=25)
        try:
            scenarios = [
                (b'/version\r', 'Zyn Agent v'),
                (b'/help model\r', '/model'),
                (b'/context\r', 'Estimated tokens'),
                (b'/stats\r', 'Actual billed usage'),
                (b'/login\r', '/login chatgpt'),
                (b'/logout github\r', 'gh auth logout'),
                (b'/model unknown-test-model\r', 'zyncloud-minimax-m3'),
            ]
            for command, expected in scenarios:
                offset = len(terminal.capture)
                terminal.send(command,0.25)
                segment = terminal.capture[offset:].decode('utf8','replace')
                self.assertIn(expected,segment,f'{command!r} failed: {segment[-600:]}')
                self.assertIsNone(terminal.proc.poll())
            terminal.send(b'/exit\r',0.35)
            self.assertEqual(terminal.wait_exit(),0)
            self.assertEqual(terminal.capture.count(b'\x1b[2J'),0)
        finally:
            terminal.close()

if __name__=='__main__':unittest.main(verbosity=2)
