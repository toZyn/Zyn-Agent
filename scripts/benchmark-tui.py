import os
import sys
import time
import re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
from tui_pty import Terminal

def benchmark(count=10000,cols=80,rows=24):
    n=min(40000,max(1200,int(count)))
    term=Terminal(cols=cols,rows=rows,command=['node','tests/tui_flood.mjs'],env_extra={'ZYN_FLOOD_MESSAGES':str(n)})
    start=time.monotonic()
    try:
        deadline=time.monotonic()+100
        while b'FLOOD_READY' not in term.capture and term.proc.poll() is None and time.monotonic()<deadline:
            term.read(0.2)
        match=re.search(rb'FLOOD_READY count=(\d+) duration_ms=(\d+) visible=(\d+) rss_mb=(\d+)',term.capture)
        if not match:
            raise RuntimeError('Flood did not finish successfully')
        clear=term.capture.count(b'\x1b[2J')
        term.send(b'\x1b[5~',0.15)
        older='Older messages' in term.text[-1200:]
        term.send(b'\x1b[6~',0.15)
        term.send(b'\x03',0.15)
        exit_code=term.wait_exit()
        print(f'count={n} cols={cols} rows={rows} insertion_ms={int(match[2])} wall_ms={int(1000*(time.monotonic()-start))} retained={int(match[3])} rss_mb={int(match[4])} screen_clears={clear} page_up={older} exit_code={exit_code}')
        if clear or not older or exit_code!=0: raise RuntimeError('Terminal benchmark regression')
    finally:term.close()

if __name__=='__main__':benchmark(sys.argv[1] if len(sys.argv)>1 else 10000)
