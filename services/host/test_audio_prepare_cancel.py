"""Ensure cancelling a bank decode terminates the decoder child."""
import importlib.util
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / 'importer' / 'decode_film_audio.py'
spec = importlib.util.spec_from_file_location('decode_film_audio_test', SCRIPT)
decoder = importlib.util.module_from_spec(spec); spec.loader.exec_module(decoder)

class CancelTests(unittest.TestCase):
    def test_cancel_stops_child_before_return(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);script=root/'slow.py';marker=root/'running';cancel=root/'cancel'
            script.write_text('import pathlib,time\npathlib.Path('+repr(str(marker))+').write_text("started")\ntime.sleep(60)\n',encoding='utf-8')
            old_vgm,old_cancel=decoder.VGM,decoder.CANCEL_FILE;decoder.VGM=sys.executable;decoder.CANCEL_FILE=cancel
            def signal():
                deadline=time.monotonic()+5
                while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
                cancel.write_text('stop',encoding='utf-8')
            worker=threading.Thread(target=signal);worker.start();start=time.monotonic()
            try:
                with self.assertRaises(KeyboardInterrupt):decoder.run([script],10)
                self.assertTrue(marker.exists());self.assertLess(time.monotonic()-start,5)
            finally:worker.join();decoder.VGM=old_vgm;decoder.CANCEL_FILE=old_cancel

if __name__ == '__main__':unittest.main()
