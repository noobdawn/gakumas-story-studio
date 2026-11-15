"""Exercise resource selection without starting Unity, a browser, or a server."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import host


class PlayerLaunchIntercepted(Exception):
    pass


class StartupResourcesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='creator-startup-resources-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.here = self.root / 'creator-prototype'
        self.player = self.here / 'build/CreatorPlayer.exe'
        self.player.parent.mkdir(parents=True)
        self.player.touch()
        for marker in ('creator-performance-v1', 'creator-film-motions-v1', 'creator-animation-layers-v1'):
            (self.player.parent / marker).touch()
        self.bundles = self.root / 'run/catalog/player-view/characters'
        self.bundles.mkdir(parents=True)
        for name in host.REQUIRED:
            (self.bundles / (name + '.bundle')).touch()
        self.scene = self.root / 'run/catalog/player-view/scenes'
        self.scene.mkdir()
        (self.scene / 'env_3d_adv_trainingroom-00-00-noon.bundle').touch()
        self.motion = self.root / 'motion.bundle'
        self.motion.touch()
        self.cloth = self.root / 'run/catalog/player-view/baseline-cloth.json'
        self.cloth.write_text('{}', encoding='utf8')
        self.argv = ['host.py', '--player', str(self.player), '--no-browser']

    def catalog(self, managed):
        root = self.root / 'run/catalog'
        (root / 'exposed').mkdir(parents=True)
        (root / 'exposed/talk.bundle').touch()
        row = {'exposed': 'exposed/talk.bundle', 'clips': [
            {'name': 'mot_all_chr_cmmn_talk-001_in_b', 'role': 'body', 'start': 0, 'stop': 2}]}
        (root / 'bundles.jsonl').write_text(json.dumps(row) + '\n', encoding='utf8')
        if managed:
            self.argv += ['--catalog-root', str(root)]
        return root

    def run_host(self, prepare_error=None):
        captured = {}

        def intercept(command, **kwargs):
            self.assertEqual(command.count('-force-d3d11'), 1)
            self.assertNotIn('-force-d3d12', command)
            manifest = Path(command[command.index('-creator-film-motions') + 1])
            captured.update(json.loads(manifest.read_text('utf8')))
            raise PlayerLaunchIntercepted()

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(host, 'HERE', self.here))
            stack.enter_context(patch('resource_catalog.require_catalog', side_effect=lambda p: Path(p)))
            stack.enter_context(patch('physics_cache.prepare', return_value=self.root/'run/catalog/player-view/physics-v1'))
            stack.enter_context(patch('sys.argv', self.argv))
            stack.enter_context(patch('host.socket.socket'))
            stack.enter_context(patch('base_motions.resolve', return_value={
                name: self.motion for name in ('shy', 'idle', 'angry', 'yes')}))
            stack.enter_context(patch('render_shader_cache.for_player', return_value=None))
            prepare = stack.enter_context(patch('animation_layer_cache.prepare', side_effect=prepare_error))
            launch = stack.enter_context(patch('host.subprocess.Popen', side_effect=intercept))
            browser = stack.enter_context(patch('host.webbrowser.open'))
            stderr = stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            if prepare_error is None:
                with self.assertRaises(PlayerLaunchIntercepted):
                    host.main()
                launch.assert_called_once()
            else:
                with self.assertRaises(SystemExit) as exc:
                    host.main()
                self.assertEqual(exc.exception.code, 2)
                self.assertIn('缓存叠加动作准备失败', stderr.getvalue())
                self.assertIn(str(prepare_error), stderr.getvalue())
                launch.assert_not_called()
            browser.assert_not_called()
        return prepare, captured

    def test_missing_catalog_is_rejected_before_process_launch(self):
        with patch('sys.argv', self.argv), patch('host.subprocess.Popen') as launch, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                host.main()
            launch.assert_not_called()

    def test_managed_catalog_still_prepares_layers(self):
        root = self.catalog(managed=True)
        prepare, data = self.run_host()
        prepare.assert_called_once_with(root)
        self.assertEqual(len(data['motions']), 1)

    def test_invalid_managed_catalog_still_blocks_startup(self):
        root = self.catalog(managed=True)
        prepare, _ = self.run_host(ValueError('缺少本批次游戏目录记录'))
        prepare.assert_called_once_with(root)


if __name__ == '__main__':
    unittest.main()
