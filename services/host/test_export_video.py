import math
import shutil
import struct
import subprocess
import tempfile
import unittest
import wave
import zlib
from unittest.mock import patch
from pathlib import Path
from export_video import VideoExport

def png16():
    def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+bytes([80,120,160])*16 for _ in range(16))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

def solid_png(width,height):
    def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+bytes([240,230,220])*width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg is required')
class ExportTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.dir=Path(self.temp.name);(self.dir/'shared').mkdir();self.id='16679d9f-0075-4f97-b570-fb82dfdce722'
        with wave.open(str(self.dir/'shared'/(self.id+'.wav')),'wb') as w:
            w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(i*2*math.pi*440/16000))) for i in range(8000)))
    def tearDown(self):self.temp.cleanup()
    def config(self):return {'output':str(self.dir/'result.mp4'),'width':16,'height':16,'fps':24,'duration':1,'audio':[{'asset':{'scope':'shared','id':self.id,'extension':'.wav'},'start':.25,'length':.5}],'captions':[{'start':.1,'end':.9,'speaker':'Test','text':'Frame test'}]}
    def test_video_audio_and_timeline_offset(self):
        job=VideoExport(self.config(),self.dir,self.dir)
        try:
            for _ in range(job.frames):job.write(png16())
            job.finish()
        finally:job.cancel()
        result=subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,codec_type,nb_read_frames','-of','csv=p=0',str(self.dir/'result.mp4')],capture_output=True,text=True,check=True).stdout
        self.assertIn('h264,video,24',result);self.assertIn('aac,audio',result)
        pcm=subprocess.run(['ffmpeg','-v','error','-i',str(self.dir/'result.mp4'),'-map','0:a','-f','s16le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
        samples=struct.unpack('<'+str(len(pcm)//2)+'h',pcm)
        quiet=max(abs(x) for x in samples[:1600]);loud=max(abs(x) for x in samples[5600:7200]);self.assertLess(quiet,500);self.assertGreater(loud,3000)
    def test_changed_destination_is_preserved_and_temp_is_cleaned(self):
        dest=self.dir/'result.mp4';dest.write_bytes(b'original');job=VideoExport(self.config(),self.dir,self.dir)
        try:
            for _ in range(job.frames):job.write(png16())
            dest.write_bytes(b'external update')
            with self.assertRaisesRegex(RuntimeError,'目标文件'):job.finish()
        finally:job.cancel()
        self.assertEqual(dest.read_bytes(),b'external update');self.assertFalse(list(self.dir.glob('.*.tmp.mp4')))
    def test_new_only_refuses_existing_or_racing_destination(self):
        dest=self.dir/'result.mp4';config=self.config();config['newOnly']=True;dest.write_bytes(b'existing')
        with self.assertRaisesRegex(ValueError,'存在'):VideoExport(config,self.dir,self.dir)
        dest.unlink();job=VideoExport(config,self.dir,self.dir)
        try:
            for _ in range(job.frames):job.write(png16())
            dest.write_bytes(b'external')
            with self.assertRaises((RuntimeError,FileExistsError)):job.finish()
        finally:job.cancel()
        self.assertEqual(dest.read_bytes(),b'external')
    def test_cancellation_keeps_existing_destination(self):
        dest=self.dir/'result.mp4';dest.write_bytes(b'original');job=VideoExport(self.config(),self.dir,self.dir)
        job.write(png16());job.cancel()
        self.assertEqual(dest.read_bytes(),b'original');self.assertFalse(list(self.dir.glob('.*.tmp.mp4')))
    def test_typewriter_subtitle_segments_and_style(self):
        config=self.config();config['captions']=[{'start':.1,'end':.9,'origin':.1,'speaker':'测试','text':'你好世界','uiStyle':'subtitle','typewriter':True,'revealRate':4}]
        job=VideoExport(config,self.dir,self.dir)
        try:
            ass=(self.dir/'captions.ass').read_text(encoding='utf-8-sig')
            self.assertIn('Style: Subtitle',ass);self.assertIn('Subtitle,,0,0,0,,测试\\N你\n',ass);self.assertIn('Subtitle,,0,0,0,,测试\\N你好世\n',ass)
            for _ in range(job.frames):job.write(png16())
            job.finish()
        finally:job.cancel()
        self.assertTrue((self.dir/'result.mp4').is_file())
    def test_game_style_uses_external_images_and_exports(self):
        assets=self.dir/'dialogue-assets';assets.mkdir()
        for name,w,h in [('message_bg.png',81,81),('frame_message_bg.png',81,81),('name_bg.png',66,64)]: (assets/name).write_bytes(solid_png(w,h))
        config=self.config();config['captions']=[{'start':.1,'end':.9,'speaker':'测试','text':'你好','uiStyle':'game','nameColor':'#6ea4fc','nameColorEnd':'#d4afff','nameTextColor':'#123456','typewriter':True,'revealRate':4}]
        with self.assertRaisesRegex(ValueError,'素材缺失'):VideoExport(config,self.dir,self.dir)
        job=VideoExport(config,self.dir,self.dir,assets)
        try:
            self.assertTrue((self.dir/'game-bg.png').is_file());self.assertIn('Style: Game',(self.dir/'captions.ass').read_text(encoding='utf-8-sig'));self.assertIn(r'\c&H563412&',(self.dir/'captions.ass').read_text(encoding='utf-8-sig'))
            for _ in range(job.frames):job.write(png16())
            job.finish()
        finally:job.cancel()
        self.assertTrue((self.dir/'result.mp4').is_file())
    def test_supported_frame_rates_without_audio(self):
        for fps in (24,25,30,60):
            with self.subTest(fps=fps):
                config=self.config();config.update(output=str(self.dir/f'{fps}.mp4'),fps=fps,audio=[],captions=[])
                job=VideoExport(config,self.dir,self.dir)
                try:
                    for _ in range(job.frames):job.write(png16())
                    job.finish()
                finally:job.cancel()
                info=subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_type,r_frame_rate,nb_read_frames','-of','json',config['output']],capture_output=True,text=True,check=True).stdout
                import json
                streams=json.loads(info)['streams'];self.assertEqual(len(streams),1);self.assertEqual(streams[0]['codec_type'],'video');self.assertEqual(streams[0]['r_frame_rate'],f'{fps}/1');self.assertEqual(int(streams[0]['nb_read_frames']),fps)

    def test_286_audio_clips_encode_and_clean_stems(self):
        config=self.config();config['captions']=[]
        base=config['audio'][0]
        config['audio']=[{**base,'start':i*.003,'length':.05,'volume':.04} for i in range(286)]
        job=VideoExport(config,self.dir,self.dir)
        try:
            self.assertIsNotNone(job.audio_directory)
            self.assertEqual(len(list(Path(job.audio_directory.name).glob('*.wav'))),9)
            for _ in range(job.frames):job.write(png16())
            job.finish()
        finally:job.cancel()
        self.assertFalse(list(self.dir.glob('audio-*')))
        pcm=subprocess.run(['ffmpeg','-v','error','-i',config['output'],'-map','0:a','-f','s16le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
        samples=struct.unpack('<'+str(len(pcm)//2)+'h',pcm)
        for time in (.03,.4,.88):
            segment=samples[round(time*16000):round((time+.02)*16000)]
            self.assertGreater(max(abs(x) for x in segment),100)
        self.assertLess(max(abs(x) for x in samples[15000:]),50)

    def test_batch_failure_and_cancellation_preserve_destination(self):
        config=self.config();config['audio']=[config['audio'][0]]*33
        destination=Path(config['output']);destination.write_bytes(b'original')
        with patch('export_video.reduce_audio_inputs',side_effect=RuntimeError('mix failed')):
            with self.assertRaisesRegex(RuntimeError,'mix failed'):VideoExport(config,self.dir,self.dir)
        job=VideoExport(config,self.dir,self.dir);job.cancel()
        self.assertEqual(destination.read_bytes(),b'original')
        self.assertFalse(list(self.dir.glob('audio-*')))
        self.assertFalse(list(self.dir.glob('.*.tmp.mp4')))

    def test_clip_limit_reports_audio_or_subtitles_and_cleans_output(self):
        for key in ('audio','captions'):
            config=self.config();config[key]=[{}]*10001
            with self.assertRaisesRegex(ValueError,'音频片段' if key=='audio' else '字幕片段'):
                VideoExport(config,self.dir,self.dir)
            self.assertFalse(list(self.dir.glob('.*.tmp.mp4')))

if __name__=='__main__':unittest.main()
