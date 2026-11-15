"""Intercept thumbnail launches; no Unity process, window or rendering is started."""
import contextlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import costume_thumbnail
import motion_thumbnail


class LaunchIntercepted(Exception):
    pass


class PlayerGraphicsAPITest(unittest.TestCase):
    def test_both_thumbnail_paths_require_d3d11(self):
        with tempfile.TemporaryDirectory(prefix='creator-graphics-api-') as td:
            root = Path(td)
            player = root / 'player/CreatorPlayer.exe'
            player.parent.mkdir()
            player.touch()
            (player.parent / 'creator-performance-v1').touch()
            catalog = root / 'catalog'
            characters = catalog / 'player-view/characters'
            bundles = catalog / 'bundles'
            characters.mkdir(parents=True)
            bundles.mkdir()
            for name in ['shader', 'actor-shader', 'm_fdc', 'mdl_chr_ttmr-base-0000_hair', 'ttmr-face-exposed']:
                (characters / (name + '.bundle')).write_bytes(b'UnityFS\0')
            body = 'mdl_chr_ttmr-casl-0002_body'
            (bundles / (body + '.bundle')).write_bytes(b'UnityFS\0')
            motion = catalog / 'idle.bundle'
            motion.write_bytes(b'UnityFS\0')
            costume = dict(id='costume-' + 'a' * 24, name=body, character='ttmr', knownCharacter=True,
                           bodyAvailable=True, dependenciesAvailable=True, thumbnailAvailable=True, dependencyBundles=[])
            for function, asset_id in [(motion_thumbnail.generate, 'asset-local-idle'),
                                       (costume_thumbnail.render, 'asset-costume-' + 'a' * 24)]:
                with self.subTest(worker=function.__module__), contextlib.ExitStack() as stack:
                    stack.enter_context(patch('resource_catalog.require_catalog', return_value=catalog))
                    stack.enter_context(patch('resource_catalog.require_characters'))
                    stack.enter_context(patch('base_motions.resolve', return_value={'shy': motion, 'idle': motion}))
                    stack.enter_context(patch('costume_catalog.load', return_value=[costume]))
                    stack.enter_context(patch('render_shader_cache.for_player', return_value=None))
                    stack.enter_context(patch('socket.socket'))

                    def intercept(command, **kwargs):
                        self.assertEqual(command[0], str(player.resolve()))
                        self.assertEqual(command.count('-force-d3d11'), 1)
                        self.assertNotIn('-force-d3d12', command)
                        self.assertIn('-batchmode', command)
                        raise LaunchIntercepted()

                    launch = stack.enter_context(patch('subprocess.Popen', side_effect=intercept))
                    with self.assertRaises(LaunchIntercepted):
                        function(asset_id, characters, player, catalog)
                    launch.assert_called_once()


if __name__ == '__main__':
    unittest.main()
