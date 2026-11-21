import json
import os
import time
import unittest
from pathlib import Path
from tui_pty import Terminal, ROOT

class ChatGPTDirectTests(unittest.TestCase):
    def test_account_model_is_usable_in_tui_without_codex_executable(self):
        def prepare(directory):
            folder=directory/'chatgpt'
            folder.mkdir(parents=True,exist_ok=True)
            (folder/'account.json').write_text(json.dumps({
                'clientId':'oaiapp_fixture','subject':'fixture','email':'fixture@example.test',
                'accessToken':'simulated-test-oauth-token','refreshToken':'simulated-test-refresh',
                'expiresAt':int(time.time()*1000)+3600000,
                'scopes':['openid','chatgpt.tokens.use.direct']
            }))
        fixture=ROOT/'tests'/'fixtures'/'chatgpt-fake-network.cjs'
        term=Terminal(prepare=prepare,env_extra={
            'ZYN_DEFAULT_MODEL':'chatgpt-account',
            'NODE_OPTIONS':f'--require={fixture}',
        })
        try:
            term.send(b'Test ChatGPT integration\r',0.5)
            deadline=time.monotonic()+9
            while 'Direct ChatGPT account path verified' not in term.text and time.monotonic()<deadline and term.proc.poll() is None:
                term.read(0.2)
            self.assertIn('Direct ChatGPT account path verified',term.text)
            self.assertIn('153/?',term.text)
            self.assertIsNone(term.proc.poll())
            term.send(b'/exit\r',0.35)
            self.assertEqual(term.wait_exit(),0)
        finally:
            term.close()

if __name__=='__main__':unittest.main(verbosity=2)
