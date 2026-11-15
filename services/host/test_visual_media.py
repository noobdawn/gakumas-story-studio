import json
import tempfile
import unittest
import uuid
import os
import subprocess
from unittest.mock import patch
from pathlib import Path
from PIL import Image
import visual_media as media
from export_video import audio_filter, audio_file

class VisualMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='creator-media-unit-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.base=self.root/'shared';self.base.mkdir()
    def asset(self,ext):
        return dict(id=str(uuid.uuid4()),scope='shared',extension=ext,type='视频' if ext in media.VIDEOS else '贴图')
    def test_transparent_image_source_unchanged_and_cache_reused(self):
        a=self.asset('.png');file=self.base/(a['id']+'.png');Image.new('RGBA',(40,80),(150,20,90,50)).save(file);original=file.read_bytes()
        info=media.prepare(file);self.assertEqual((info['width'],info['height']),(40,80));self.assertEqual(file.read_bytes(),original)
        resolved,_=media.resolve(self.root,a);self.assertEqual(Image.open(resolved).getpixel((0,0)),(150,20,90,50));stamp=resolved.stat().st_mtime_ns
        self.assertEqual(media.prepare(file),info);self.assertEqual(resolved.stat().st_mtime_ns,stamp)
        with self.assertRaises(ValueError):media.resolve(self.root,{**a,'id':'../outside'})
    def test_video_proxy_poster_audio_and_frame_metadata(self):
        a=self.asset('.mp4');file=self.base/(a['id']+'.mp4')
        media.run([media.binary('ffmpeg'),'-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=12:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(file)])
        original=media.digest(file);info=media.prepare(file)
        self.assertEqual(info['frameCount'],12);self.assertTrue(info['hasAudio']);self.assertEqual(info['fps'],12);self.assertEqual(media.digest(file),original)
        self.assertEqual(audio_file(self.root,a).name,'audio.wav')
        draws=media.resolve_draws(self.root,[dict(id='clip',asset=a,time=.5,points=[0,0,1,0,1,1,0,1],uv=[0,0,1,1],color=[1,1,1,1],pivot=[.5,.5])]);self.assertEqual(draws[0]['kind'],'video');self.assertNotIn('asset',draws[0]);self.assertTrue(Path(draws[0]['file']).is_file())
    def test_audio_speed_chain_changes_source_duration_before_fades(self):
        chain=audio_filter(1,0,2,1,2,1,.1,.2,False,None,2)
        self.assertIn('duration=4.000000000',chain);self.assertLess(chain.index('atempo='),chain.index('afade='))
        self.assertIn('atempo=0.5,atempo=0.500000000',audio_filter(1,0,2,1,2,1,0,0,rate=.25))
    @unittest.skipUnless(os.name == 'nt', 'Windows cache access inheritance')
    def test_published_cache_inherits_library_access(self):
        a=self.asset('.png');file=self.base/(a['id']+'.png')
        Image.new('RGB',(8,8)).save(file);media.prepare(file)
        directory=str(file.with_suffix('.media')).replace("'","''")
        protected=subprocess.check_output(['powershell','-NoProfile','-Command',
            f"[System.IO.Directory]::GetAccessControl('{directory}').AreAccessRulesProtected"],
            creationflags=subprocess.CREATE_NO_WINDOW,text=True).strip()
        self.assertEqual(protected,'False','Published caches must not retain owner-only temporary-directory ACLs')
    def test_failed_conversion_removes_stage_and_keeps_source(self):
        a=self.asset('.png');file=self.base/(a['id']+'.png')
        Image.new('RGB',(8,8)).save(file);original=file.read_bytes();run=media.run
        def fail_encode(args,*rest,**kwargs):
            if Path(args[0]).stem.lower()=='ffmpeg':raise ValueError('conversion failed')
            return run(args,*rest,**kwargs)
        with patch.object(media,'run',side_effect=fail_encode),self.assertRaisesRegex(ValueError,'conversion failed'):
            media.prepare(file)
        self.assertEqual(file.read_bytes(),original)
        self.assertEqual(list(self.base.iterdir()),[file])
    def test_delayed_video_normalizes_audio_and_non_square_pixels(self):
        import wave, struct
        a=self.asset('.mp4');file=self.base/(a['id']+'.mp4')
        media.run([media.binary('ffmpeg'),'-v','error','-itsoffset','0.5','-f','lavfi','-i','testsrc2=size=64x48:rate=12:duration=1','-f','lavfi','-i',r'aevalsrc=if(lt(t\,0.5)\,0\,0.5*sin(2*PI*440*t)):d=1.5','-vf','setsar=2','-vsync','0','-c:v','libx264','-c:a','aac',str(file)])
        info=media.prepare(file);self.assertEqual((info['width'],info['height']),(128,48));self.assertAlmostEqual(info['duration'],1,places=2)
        with wave.open(str(audio_file(self.root,a))) as wav:
            raw=wav.readframes(9600);samples=struct.unpack('<'+'h'*(len(raw)//2),raw)
            self.assertGreater(sum(abs(x) for x in samples)/len(samples),1000)

if __name__=='__main__':unittest.main()
