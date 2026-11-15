import json
import tempfile
import unittest
from pathlib import Path
from export_video import VideoExport, assert_video_destination

class WriteGuardTest(unittest.TestCase):
    def test_selected_invalid_and_changed_directory(self):
        with tempfile.TemporaryDirectory(prefix='creator-video-guard-') as root:
            root=Path(root); game=root/'game'; game.mkdir(); data=root/'data'; data.mkdir(); other=root/'game-other'; other.mkdir()
            config=data/'game-directory.json'; config.write_text(json.dumps({'game':str(game)}),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'只读游戏目录'): assert_video_destination(game,data)
            assert_video_destination(other,data)
            game.rename(root/'removed')
            with self.assertRaisesRegex(ValueError,'只读游戏目录'): assert_video_destination(game,data)
            config.write_text('null',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'设置无效'): assert_video_destination(other,data)
            config.write_text('{bad',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'设置无法读取'): assert_video_destination(other,data)

    def test_export_checks_before_temp_and_before_commit(self):
        with tempfile.TemporaryDirectory(prefix='creator-video-guard-') as root:
            root=Path(root); game=root/'game'; game.mkdir(); data=root/'data'; data.mkdir(); work=root/'work'; work.mkdir()
            config=data/'game-directory.json'; config.write_text(json.dumps({'game':str(game)}),encoding='utf-8')
            settings={'output':str(game/'film.mp4'),'fps':24,'width':64,'height':64,'duration':1}
            with self.assertRaisesRegex(ValueError,'只读游戏目录'): VideoExport(settings,data,work)
            self.assertEqual(list(game.iterdir()),[])
            class Process:
                class Input:
                    def close(self): pass
                stdin=Input()
                def wait(self): return 0
            class Log:
                def close(self): pass
            previous=root/'previous';previous.mkdir();config.write_text(json.dumps({'game':str(previous)}),encoding='utf-8')
            assert_video_destination(game,data)
            job=VideoExport.__new__(VideoExport); job.native_ui=False;job.count=job.frames=1;job.proc=Process();job.log=Log();job.root=data;job.output=game/'film.mp4'
            config.write_text(json.dumps({'game':str(game)}),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'只读游戏目录'): job.finish()
            self.assertFalse(job.output.exists())

if __name__=='__main__': unittest.main()
