import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from resource_catalog import require_catalog, require_characters


class ResourceCatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='creator-catalog-test-')
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.game = base / 'game'
        self.manifest = self.game / 'octo/pdb/octocacheevai'
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_bytes(b'current manifest')
        self.root = base / 'cache/runs/run-id/catalog'
        (self.root / 'player-view/characters').mkdir(parents=True)
        def write(p, value):
            p.write_text(json.dumps(value), 'utf8')
        write(base / 'cache/.creator-asset-cache.json', {'id': 'cache-id'})
        write(self.root.parent / '.creator-run.json', {'version': 1, 'runId': 'run-id', 'cacheId': 'cache-id'})
        write(self.root.parent / 'inventory.json', {'game': str(self.game), 'manifest_sha256': hashlib.sha256(self.manifest.read_bytes()).hexdigest()})

    def test_current_managed_batch(self):
        self.assertEqual(require_catalog(self.root), self.root.resolve())
        require_characters(self.root, self.root / 'player-view/characters')

    def test_missing_catalog_is_not_sample_mode(self):
        with self.assertRaisesRegex(ValueError, '必须指定'):
            require_catalog(None)

    def test_game_update_invalidates_batch(self):
        self.manifest.write_bytes(b'updated')
        with self.assertRaisesRegex(ValueError, '清单已变化'):
            require_catalog(self.root)

    def test_unmanaged_directory_rejected(self):
        (self.root.parent / '.creator-run.json').unlink()
        with self.assertRaises(OSError):
            require_catalog(self.root)

    def test_mixing_character_resources_rejected(self):
        with self.assertRaisesRegex(ValueError, '同一解包批次'):
            require_characters(self.root, self.game)


if __name__ == '__main__':
    unittest.main()
