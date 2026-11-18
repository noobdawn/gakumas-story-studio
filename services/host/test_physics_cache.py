import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import physics_cache


class ExistingPhysicsBatchTest(unittest.TestCase):
    def test_add_face_group_to_existing_batch_and_validate_it_on_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'mdl_chr_ttmr-base-0000_face'
            index = json.dumps({'name': name, 'file': 'bundles/' + name + '.bundle'}).encode()
            (root / 'bundles.jsonl').write_bytes(index)
            bundles = root / 'bundles'
            bundles.mkdir()
            (bundles / (name + '.bundle')).write_bytes(b'fixture')
            base = root / 'player-view/physics-v1'
            base.mkdir(parents=True)
            report = json.dumps({'version': 1, 'fingerprint': hashlib.sha256(index).hexdigest(), 'items': []})
            (base / 'report.json').write_text(report, 'utf8')
            data = {'source': name, 'dynamic': [], 'static': [{'name': 'Head_Face', 'collisionMask': 8}]}
            with patch('resource_catalog.require_catalog', return_value=root), patch('prepare_costume_swing.extract', return_value=data) as extract:
                self.assertEqual(physics_cache.prepare(root), base)
                self.assertEqual(physics_cache.prepare(root), base)
                extract.assert_called_once_with(bundles / (name + '.bundle'), name, [])
                self.assertEqual((base / 'report.json').read_text('utf8'), report)
                face = base / 'faces-v1' / (name + '.json')
                self.assertEqual(json.loads(face.read_text('utf8')), data)
                face.write_text('{}', 'utf8')
                with self.assertRaisesRegex(ValueError, '已变化'):
                    physics_cache.prepare(root)
