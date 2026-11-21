import unittest
from pathlib import Path
from tui_pty import Terminal

class RecoveryTests(unittest.TestCase):
    def test_invalid_profile_export_reprompts_instead_of_crashing(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.3)
            self.assertIn('Paste',term.text)
            self.assertNotIn('[P] Paste',term.text)
            self.assertNotIn(':save',term.text)
            term.send(b'b\n\n',0.4)
            self.assertIn('Invalid export',term.text)
            self.assertIsNone(term.proc.poll())
            doc=b'## MEMORIES\n### Personal Context\n1. Test\n\n## PREFERENCES\n### Tone\n1. Clear\n\n'
            term.send(doc,0.6)
            self.assertIn('Profile saved for future sessions',term.text)
            self.assertIn('Test',(Path(term.tmp.name)/'chat'/'imported-memory.md').read_text())
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_setup_has_real_colors_and_framed_prompt(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.4)
            self.assertIn('Paste',term.text)
            self.assertIn('╭',term.text)
            self.assertIn(b'\x1b[',term.capture)
            self.assertRegex(term.capture.decode('utf8','replace'),r'\x1b\[[0-9;]*m')
        finally:term.close()

    def test_onboarding_uses_persisted_dracula_theme(self):
        import json
        def prepare(directory):
            config=directory/'chat'/'persistent-config.json'
            config.parent.mkdir(parents=True,exist_ok=True)
            config.write_text(json.dumps({'theme':'dracula','language':'en'}))
        term=Terminal(cols=64,rows=23,prepare=prepare,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            self.assertIn(b'\x1b[38;2;255;121;198m',term.capture)
            term.send(b'y\n',0.3)
            self.assertIn(b'\x1b[38;2;255;121;198m',term.capture)
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
            term.read(1.3)
            self.assertIn('new session',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_long_tool_output_scrolls_without_text_limits_on_phone(self):
        term=Terminal(cols=52,rows=20,command=['node','tests/tui_event_fixture.mjs'],env_extra={'CI':'','GITHUB_ACTIONS':''},wait_ready=False)
        try:
            term.read(0.7)
            self.assertIn('abcdefghij',term.text)
            term.send(b'\x1b[1;5H',0.3)
            self.assertIn('Completed Command free -h',term.text)
            self.assertNotIn('/transcript',term.text)
            self.assertNotIn(b'\x1b[2J',term.capture)
            term.send(b'\x03',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_multisection_paste_does_not_save_before_last_preference(self):
        term=Terminal(cols=72,rows=26,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.3)
            pasted=b'## MEMORIES\n### Work Context\n1. Developer\n\n## PREFERENCES\n### Tone\n1. Professional\n\n### Avoid\n1. No childish wording\n\n'
            term.send(pasted,0.65)
            self.assertIn('Profile saved for future sessions',term.text)
            saved=(Path(term.tmp.name)/'chat'/'imported-memory.md').read_text()
            self.assertIn('No childish wording',saved)
        finally:term.close()

    def test_bracketed_paste_supports_multiline_export(self):
        term=Terminal(cols=64,rows=23,env_extra={'ZYN_SKIP_ONBOARDING':'0'},wait_ready=False)
        try:
            term.send(b'y\n',0.2)
            content=b'## MEMORIES\n### Personal Context\n1. Session\n\n## PREFERENCES\n### Tone\n1. Simple\n'
            term.send(b'\x1b[200~'+content+b'\x1b[201~\n\n',0.6)
            self.assertIn('Profile saved for future sessions',term.text)
            saved=(Path(term.tmp.name)/'chat'/'imported-memory.md').read_text()
            self.assertIn('1. Simple',saved)
        finally:term.close()
