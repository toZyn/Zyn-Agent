import unittest
from pathlib import Path
from tui_pty import Terminal

class RecoveryTests(unittest.TestCase):
    def test_invalid_profile_export_reprompts_instead_of_crashing(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.3)
            self.assertIn('Here is the following prompt',term.text)
            term.send(b'p\n',0.2)
            term.send(b'b\n:save\n',0.4)
            self.assertIn('Invalid export',term.text)
            self.assertIsNone(term.proc.poll())
            doc=b'## MEMORIES\n### Personal Context\n1. Test\n## PREFERENCES\n### Tone\n1. Clear\n:save\n'
            term.send(doc,0.5)
            self.assertIn('Profile saved for future sessions',term.text)
            self.assertIn('Test',(Path(term.tmp.name)/'chat'/'imported-memory.md').read_text())
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_setup_has_real_colors_and_framed_prompt(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.4)
            self.assertIn('Here is the following prompt',term.text)
            self.assertIn('┌',term.text)
            self.assertIn('│',term.text)
            self.assertIn(b'\x1b[',term.capture)
            self.assertRegex(term.capture.decode('utf8','replace'),r'\x1b\[[0-9;]*m')
        finally:term.close()

    def test_banner_restores_framed_design_and_accent_color(self):
        term=Terminal(cols=62,rows=20)
        try:
            term.read(0.4)
            self.assertIn('┌',term.text)
            self.assertIn('└',term.text)
            self.assertIn('Zyn',term.text)
            self.assertRegex(term.capture.decode('utf8','replace'),r'\x1b\[[0-9;]*m')
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_model_switch_updates_context_limit_in_status_without_restart(self):
        term=Terminal(cols=98,rows=24)
        try:
            term.send(b'/model gpt-4\r',0.4)
            self.assertIn('8.2K',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_first_run_intro_is_framed_and_easy_to_skip(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            self.assertIn('╭',term.text)
            self.assertIn('Optional setup',term.text)
            self.assertIn('Import',term.text)
            self.assertIn('Skip',term.text)
            term.send(b'n\n',0.35)
            self.assertIn('new session',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_long_tool_output_preview_preserves_readability_on_phone(self):
        term=Terminal(cols=52,rows=20,command=['node','tests/tui_event_fixture.mjs'],env_extra={'CI':'','GITHUB_ACTIONS':''},wait_ready=False)
        try:
            term.read(0.7)
            self.assertIn('Completed Command free -h',term.text)
            self.assertIn('/transcript',term.text)
            self.assertNotIn('1234567890'*8,term.text)
            self.assertNotIn(b'\x1b[2J',term.capture)
            term.send(b'\x03',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()
