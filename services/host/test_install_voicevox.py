import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import zipfile
import install_voicevox as installer


class InstallProgressTest(unittest.TestCase):
    def test_download_reports_bytes_then_verifies_without_network(self):
        payload=b'artificial voice data'
        item=dict(name='fixture',url='https://example.invalid/fixture',bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())
        with tempfile.TemporaryDirectory() as temporary, patch.object(installer.urllib.request,'urlopen',return_value=io.BytesIO(payload)), patch.object(installer,'emit') as emit:
            target=installer.download(item,Path(temporary),itemIndex=2,itemTotal=4)
            self.assertEqual(target.read_bytes(),payload)
            events=[c.kwargs for c in emit.call_args_list]
            self.assertEqual([e['phase'] for e in events],['verify','download','verify'])
            self.assertEqual(events[1]['received'],len(payload))
            self.assertEqual(events[1]['total'],len(payload))
            self.assertTrue(all(e['itemIndex']==2 and e['itemTotal']==4 for e in events))

    def test_install_reports_unpack_and_install_with_file_sequence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);voice=root/'voice';voice.mkdir();catalog=root/'resources/voicevox';catalog.mkdir(parents=True)
            (catalog/'models.json').write_text(json.dumps({'models':[{'id':'fixture.vvm','sha256':'unused'}]}))
            (catalog/'components.json').write_text(json.dumps([{'name':'core','kind':'zip'}]))
            archive=root/'fixture.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('fixture.txt','fixture')
            model=root/'fixture.vvm';model.write_bytes(b'fixture')
            with patch.object(installer,'ROOT',root),patch.object(installer,'VOICE',voice),patch.object(installer,'download',side_effect=[archive,model]),patch.object(installer,'emit') as emit:
                installer.install(['fixture.vvm'],voice/'.install-test')
            events=[c.kwargs for c in emit.call_args_list]
            self.assertIn(dict(phase='unpack',itemIndex=1,itemTotal=2),events)
            self.assertIn(dict(phase='install',itemIndex=2,itemTotal=2),events)
            self.assertTrue(events[-1]['done'])
            self.assertEqual((voice/'voicevox/models/fixture.vvm').read_bytes(),b'fixture')
            self.assertFalse((voice/'.install-test').exists())
