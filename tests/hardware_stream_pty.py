import codecs
import json
import time
import unittest
from tui_pty import Terminal, ROOT
import pyte

class HardwareStreamTests(unittest.TestCase):
    def test_real_provider_agent_tools_child_and_markdown_never_mix_protocol_with_text(self):
        def prepare(directory):
            folder=directory/'chatgpt'
            folder.mkdir(parents=True,exist_ok=True)
            (folder/'account.json').write_text(json.dumps({'clientId':'oaiapp_fixture','subject':'fixture','accessToken':'simulated-test-token','refreshToken':'simulated-refresh','expiresAt':int(time.time()*1000)+3600000,'scopes':['openid','chatgpt.tokens.use.direct']}))
        term=Terminal(cols=62,rows=28,prepare=prepare,env_extra={'ZYN_DEFAULT_MODEL':'chatgpt-account','NODE_OPTIONS':'--require='+str(ROOT/'tests/fixtures/hardware-stream-network.cjs')})
        view=pyte.Screen(62,28)
        decoder=codecs.getincrementaldecoder('utf8')('replace')
        consumed=0
        def screen():
            nonlocal consumed
            pyte.Stream(view).feed(decoder.decode(bytes(term.capture[consumed:])))
            consumed=len(term.capture)
            return '\n'.join(view.display)
        def await_screen(predicate):
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                value=screen()
                if predicate(value): return value
                if term.proc.poll() is not None: self.fail('Application exited: '+term.text[-2500:])
                term.read(0.05)
            self.fail('Screen condition timed out: '+value+'\nCAPTURE: '+term.text[-3000:])
        try:
            term.send('Inspecciona hardware y usa un subagente\r'.encode(),0.05)
            live=await_screen(lambda text:'COMENTARIO_EN_VIVO' in text)
            self.assertIn('›',live)
            self.assertIn('Revisaré RAM y CPU.',live)
            self.assertNotIn('**',live)
            self.assertNotIn('"type"',live)
            screen()
            view.resize(lines=24,columns=48)
            term.resize(48,24)
            await_screen(lambda text:'Run command' in text)
            term.send(b'y',0.1)
            await_screen(lambda text:'RESULTADO_FINAL_UNICO' in text)
            screen()
            view.resize(lines=55,columns=90)
            term.resize(90,55)
            final=await_screen(lambda text:'RESULTADO_FINAL_UNICO' in text and 'Type a message' in text)
            self.assertNotIn('"type"',term.text)
            self.assertNotIn('"args"',term.text)
            self.assertNotIn('**',final)
            self.assertIn('2. Qwen3',final)
            self.assertIn('3. Llama',final)
            self.assertIn('Q4_K_M',final)
            self.assertIn('C:\\new\\test',final)
            self.assertIn('sin perder este texto largo',final)
            self.assertEqual(final.count('RESULTADO_FINAL_UNICO'),1)
            self.assertIn('CHILD_OK',term.text)
            self.assertRegex(term.text, r'AGENT ✓ (Completed|Completado) wait_agent')
            self.assertIn('╭',term.text)
            self.assertEqual(term.capture.count(b'\x1b[2J'),0)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally: term.close()

    def test_interactive_question_then_subagent_returns_once_without_protocol_text(self):
        def prepare(directory):
            folder=directory/'chatgpt'
            folder.mkdir(parents=True,exist_ok=True)
            (folder/'account.json').write_text(json.dumps({'clientId':'oaiapp_fixture','subject':'fixture','accessToken':'simulated-test-token','refreshToken':'simulated-refresh','expiresAt':int(time.time()*1000)+3600000,'scopes':['openid','chatgpt.tokens.use.direct']}))
        term=Terminal(cols=62,rows=34,prepare=prepare,env_extra={'ZYN_DEFAULT_MODEL':'chatgpt-account','NODE_OPTIONS':'--require='+str(ROOT/'tests/fixtures/hardware-stream-network.cjs')})
        try:
            term.send(b'Preguntas fixture sobre videojuegos\r',0.05)
            deadline=time.monotonic()+15
            while 'Elige un tema' not in term.text and time.monotonic()<deadline:
                term.read(0.05)
            self.assertIn('Elige un tema',term.text)
            self.assertIn('Prepararé preguntas con un subagente.',term.text)
            term.send(b'\r',0.1)
            while 'PREGUNTAS_LISTAS' not in term.text and time.monotonic()<deadline:
                term.read(0.05)
            term.read(0.3)
            view=pyte.Screen(62,34)
            pyte.Stream(view).feed(term.capture.decode('utf8','replace'))
            final='\n'.join(view.display)
            self.assertIn('PREGUNTAS_LISTAS',final)
            self.assertIn('2. ¿Qué personaje prefieres?',final)
            self.assertIn('3. ¿Qué cambiarías de ese juego?',final)
            self.assertIn('CHILD_OK',term.text)
            self.assertRegex(term.text, r'AGENT ✓ (Completed|Completado) wait_agent')
            self.assertIn('╭',term.text)
            self.assertEqual(final.count('PREGUNTAS_LISTAS'),1)
            self.assertNotIn('"type"',term.text)
            self.assertNotIn('"args"',term.text)
            self.assertNotIn('Voy a crear el subagente de revisión.Voy',term.text)
            term.send(b'/exit\r',0.3)
            self.assertEqual(term.wait_exit(),0)
        finally: term.close()
