import json
from pathlib import Path
import tempfile
import unittest

from game_alias_catalog import editor_rows

class GameAliasTest(unittest.TestCase):
    def test_batch_identity_source_and_empty_decisions(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog=Path(directory)/'run-a/catalog'
            catalog.mkdir(parents=True)
            self.assertEqual(editor_rows(catalog),{})
            (catalog/'summary.json').write_text('{"manifest_sha256":"digest"}',encoding='utf8')
            rows={'asset-1':['se_open','开门声'],'asset-2':['se_123',''],
                  'classroom-chair-0':['chair_00','教室椅子 00']}
            data=dict(version=1,runId='run-a',manifest='digest',editor=rows,resources={'asset:old':['not for the renderer','']})
            file=catalog/'resource-aliases.zh-CN.json'
            file.write_text(json.dumps(data),encoding='utf8')
            self.assertEqual(editor_rows(catalog),rows)
            file.write_text(json.dumps({**data,'runId':'run-b'}),encoding='utf8')
            with self.assertRaises(ValueError):editor_rows(catalog)
