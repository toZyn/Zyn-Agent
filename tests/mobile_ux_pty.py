import os
import time
import unittest
from pathlib import Path
from tui_pty import Terminal, ROOT

class MobileUxTests(unittest.TestCase):
    def test_default_english_on_a_spanish_system_and_command_suggestion(self):
        term=Terminal(cols=52,rows=18,env_extra={'LANG':'es_PE.UTF-8','ZYN_DEFAULT_LANG':'','ZYN_LANGUAGE':''})
        try:
            self.assertIn('new session',term.text.lower())
            self.assertNotIn('sesión nueva',term.text)
            term.send(b'/moddl\r',0.3)
            self.assertIn('Did you mean /model?',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally: term.close()

    def test_chatgpt_login_is_compact_and_never_prints_long_link_automatically(self):
        fixture=ROOT/'tests'/'fixtures'/'chatgpt-login-mock.cjs'
        term=Terminal(cols=52,rows=18,env_extra={'NODE_OPTIONS':f'--require={fixture}'})
        try:
            term.send(b'/login chatgpt\r',0.6)
            self.assertIn('Connect ChatGPT',term.text)
            self.assertNotIn('THIS_IS_A_LONG_PRIVATE_LOGIN_URL',term.text)
            term.send(b'c',0.3)
            self.assertIn('Login link copied',term.text)
            term.send(b'\x1b',0.3)
            term.send(b'/exit\r',0.35)
            self.assertEqual(term.wait_exit(),0)
            self.assertNotIn('THIS_IS_A_LONG_PRIVATE_LOGIN_URL',term.text)
        finally: term.close()

    def test_language_picker_is_interactive_and_does_not_require_codes(self):
        term=Terminal(cols=60,rows=18)
        try:
            term.send(b'/lang\r',0.3)
            self.assertIn('Choose language',term.text)
            term.send(b'2\r',0.4)
            self.assertIn('esc salir',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_language_switch_updates_live_status_without_restarting(self):
        term=Terminal(cols=60,rows=18)
        try:
            previous=len(term.capture)
            term.send(b'/lang es\r',0.45)
            self.assertIn('esc salir',term.capture[previous:].decode('utf8','replace'))
            previous=len(term.capture)
            term.send(b'/lang en\r',0.45)
            self.assertIn('esc exit',term.capture[previous:].decode('utf8','replace'))
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally: term.close()

    def test_ctrl_c_during_authentication_exits_without_hanging(self):
        fixture=ROOT/'tests'/'fixtures'/'chatgpt-login-mock.cjs'
        term=Terminal(cols=52,rows=18,env_extra={'NODE_OPTIONS':f'--require={fixture}'})
        try:
            term.send(b'/login chatgpt\r',0.45)
            self.assertIn('Connect ChatGPT',term.text)
            term.send(b'\x03',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_cli_chatgpt_login_hides_url_and_supports_cancel(self):
        fixture=ROOT/'tests'/'fixtures'/'chatgpt-login-mock.cjs'
        term=Terminal(cols=60,rows=18,command=['node','zyn.js','auth','chatgpt','login'],wait_ready=False,
                      env_extra={'NODE_OPTIONS':f'--require={fixture}'})
        try:
            term.read(0.4)
            self.assertIn('Connect ChatGPT',term.text)
            self.assertNotIn('THIS_IS_A_LONG_PRIVATE_LOGIN_URL',term.text)
            term.send(b'c\n',0.25)
            self.assertIn('Login URL copied',term.text)
            term.send(b'q\n',0.35)
            self.assertEqual(term.wait_exit(),0)
            self.assertNotIn('THIS_IS_A_LONG_PRIVATE_LOGIN_URL',term.text)
        finally: term.close()

    def test_direct_account_model_id_is_shown_without_internal_prefix(self):
        import json
        def prepare(directory):
            (directory/'chatgpt').mkdir()
            (directory/'chatgpt'/'models.json').write_text(json.dumps({'models':[{'slug':'gpt-6-luna','label':'GPT-6 Luna'}]}))
        term=Terminal(cols=60,rows=18,prepare=prepare,env_extra={'ZYN_DEFAULT_MODEL':'gpt-6-luna'})
        try:
            self.assertIn('gpt-6-luna',term.text)
            self.assertNotIn('chatgpt-gpt-6-luna',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally:term.close()

    def test_command_approval_never_appears_as_a_generic_selector(self):
        term=Terminal(cols=52,rows=18,command=['node','tests/tui_confirmation_fixture.mjs'],env_extra={'CI':'','GITHUB_ACTIONS':''})
        try:
            deadline=time.monotonic()+5
            while 'Run command' not in term.text and time.monotonic()<deadline and term.proc.poll() is None:
                term.read(0.15)
            self.assertIn('Run command',term.text)
            self.assertIn('View details',term.text)
            self.assertNotIn('Pick a model',term.text)
            term.send(b'v',0.3)
            self.assertIn('Directory',term.text)
            term.send(b'n',0.3)
            self.assertIn('Command denied',term.text)
            term.send(b'\x03',0.3)
            self.assertEqual(term.wait_exit(),0)
            self.assertEqual(term.capture.count(b'\x1b[2J'),0)
        finally:term.close()

if __name__=='__main__':unittest.main(verbosity=2)
