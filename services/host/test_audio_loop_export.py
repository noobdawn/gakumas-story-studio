"""Exercise the production export audio chain without producing video."""
import json,shutil,struct,subprocess,tempfile,unittest,wave
from pathlib import Path
from unittest.mock import MagicMock,patch
from export_video import VideoExport,audio_input_args,audio_filter,audio_loop_cost,audio_loop_budget,validate_original_loop

@unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg is required')
class AudioLoopExportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.file=Path(self.temp.name)/'pattern.wav';self.rate=16000
        samples=[value for value in (4000,8000,-4000,-8000) for _ in range(self.rate//8)]
        with wave.open(str(self.file),'wb') as w:w.setparams((1,2,self.rate,0,'NONE','not compressed'));w.writeframes(struct.pack('<'+'h'*len(samples),*samples))
    def tearDown(self):self.temp.cleanup()
    def render(self,loop,offset=.25,fade=0):
        args=['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono:d=2',*audio_input_args(self.file,loop),'-filter_complex',audio_filter(1,.1,1.1,offset,1.1,1,fade,fade,loop),'-map','[a1]','-f','s16le','-ac','1','-ar','16000','pipe:1']
        result=subprocess.run(args,capture_output=True,check=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout
        return struct.unpack('<'+'h'*(len(result)//2),result)
    def test_loop_wraps_entire_file_after_offset_and_stops_at_clip_end(self):
        pcm=self.render(True,fade=.1);self.assertEqual(len(pcm),round(1.2*self.rate));self.assertLess(max(abs(x) for x in pcm[:1000]),10)
        for time,expected in ((.24,-8000),(.30,-8000),(.40,4000),(.55,8000),(.70,-4000),(.80,-8000),(1.0,8000)):
            self.assertAlmostEqual(pcm[round(time*self.rate)],expected,delta=15)
        self.assertLess(abs(pcm[round(1.19*self.rate)]),2000)
        one=self.render(False);self.assertLess(len(one),len(pcm)//2)
    def test_large_source_offset_wraps_consistently(self):
        self.assertEqual(self.render(True,.25),self.render(True,.75))
        with self.assertRaisesRegex(ValueError,'loop'):audio_input_args(self.file,'yes')
    def test_wrapped_negative_phase_matches_continuous_loop(self):
        # Moving a left edge earlier by 0.125 s turns offset 0 into 0.375 s
        # for this half-second source. The original start must retain phase.
        wrapped=self.render(True,.375)
        continuous=self.render(True,0)
        delta=round(.125*self.rate)
        start=round(.1*self.rate)
        self.assertEqual(wrapped[start+delta:start+delta+round(.8*self.rate)],continuous[start:start+round(.8*self.rate)])
    def test_compressed_formats_loop_at_decoded_sample_boundary(self):
        # Compare the loop filter with the same FFmpeg decoder's one-pass PCM.
        for ext,codec in (('mp3','libmp3lame'),('ogg','libvorbis'),('m4a','aac')):
            with self.subTest(format=ext):
                target=Path(self.temp.name)/('source.'+ext)
                subprocess.run(['ffmpeg','-v','error','-i',str(self.file),'-c:a',codec,str(target)],check=True,capture_output=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                once=subprocess.run(['ffmpeg','-v','error','-i',str(target),'-f','s16le','-ac','1','-ar',str(self.rate),'pipe:1'],check=True,capture_output=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout
                frames=len(once)//2;self.assertGreater(frames,0)
                args=['ffmpeg','-v','error',*audio_input_args(target,True),'-filter_complex',audio_filter(0,0,2,0,2,1,0,0,True),'-map','[a0]','-f','s16le','-ac','1','-ar',str(self.rate),'pipe:1']
                looped=subprocess.run(args,check=True,capture_output=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout
                self.assertEqual(len(looped),self.rate*2*2);self.assertEqual(looped[:len(once)],once);self.assertEqual(looped[len(once):2*len(once)],once)
    def test_original_loop_preserves_intro_and_repeats_range_with_offset(self):
        import hashlib
        loop={'start':2000,'end':6000,'sampleRate':self.rate,'frames':8000,'sha256':hashlib.sha256(self.file.read_bytes()).hexdigest()}
        region=validate_original_loop(self.file,loop);self.assertEqual(region,(2000,6000))
        with wave.open(str(self.file),'rb') as wav:once=wav.readframes(wav.getnframes())
        expected=once[:6000*2]+once[2000*2:6000*2]*10
        for offset in (0,.375,.75):
            args=['ffmpeg','-v','error',*audio_input_args(self.file,True),'-filter_complex',audio_filter(0,0,1,offset,1,1,0,0,True,region),'-map','[a0]','-f','s16le','-ac','1','-ar',str(self.rate),'pipe:1']
            actual=subprocess.run(args,capture_output=True,check=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout
            begin=round(offset*self.rate)*2;self.assertEqual(actual,expected[begin:begin+2*self.rate])
        with self.assertRaisesRegex(ValueError,'变化'):validate_original_loop(self.file,{**loop,'sha256':'0'*64})
        with self.assertRaisesRegex(ValueError,'循环点'):validate_original_loop(self.file,{**loop,'end':9000})
    def test_loop_mixes_with_one_shot_and_ends_without_video(self):
        first=audio_filter(1,.1,1.1,.25,1.1,.5,0,0,True);second=audio_filter(2,.2,.5,0,.5,.25,0,0,False)
        graph=first+';'+second+';[a1][a2]amix=inputs=2:normalize=0:duration=longest,apad,atrim=duration=1.2[a]'
        args=['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono:d=2',*audio_input_args(self.file,True),*audio_input_args(self.file,False),'-filter_complex',graph,'-map','[a]','-f','s16le','-ac','1','-ar','16000','pipe:1']
        result=subprocess.run(args,capture_output=True,check=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout;pcm=struct.unpack('<'+'h'*(len(result)//2),result)
        self.assertEqual(len(pcm),round(1.2*self.rate));self.assertAlmostEqual(pcm[round(.46*self.rate)],1000,delta=20);self.assertAlmostEqual(pcm[round(.8*self.rate)],-4000,delta=20)
    def test_loop_memory_budget_is_checked_before_encoding(self):
        probe=shutil.which('ffprobe')
        if probe:self.assertGreater(audio_loop_cost(probe,self.file),self.rate*2)
        with self.assertRaisesRegex(ValueError,'FFprobe'):audio_loop_cost(None,self.file)
        self.assertEqual(audio_loop_budget(100,200),300)
        with self.assertRaisesRegex(ValueError,'过长'):audio_loop_budget(256*1024*1024+1,0)
        with self.assertRaisesRegex(ValueError,'过多'):audio_loop_budget(200*1024*1024,400*1024*1024)
        metadata={'streams':[{'sample_rate':'48000','channels':2,'duration':'N/A'}],'format':{'duration':'5'}}
        with patch('export_video.subprocess.run',return_value=MagicMock(stdout=json.dumps(metadata).encode())):
            self.assertEqual(audio_loop_cost('ffprobe',self.file),int(6.5*48000)*2*8)
    def test_export_wires_loop_filter_and_rejects_excess_before_start(self):
        root=Path(self.temp.name);shared=root/'shared';shared.mkdir();ident='11111111-1111-4111-8111-111111111111';target=shared/(ident+'.wav');shutil.copyfile(self.file,target)
        asset={'scope':'shared','id':ident,'extension':'.wav'};config={'output':str(root/'result.mp4'),'width':16,'height':16,'fps':24,'duration':1,'audio':[{'asset':asset,'start':0,'length':1,'offset':.25,'loop':True},{'asset':asset,'start':0,'length':1}],'captions':[]}
        fake=MagicMock();fake.poll.return_value=None;fake.stdin.closed=False
        with patch('export_video.audio_loop_cost',return_value=1024),patch('export_video.subprocess.Popen',return_value=fake) as spawn:
            job=VideoExport(config,root,root)
            try:
                graph=(root/'filter.txt').read_text(encoding='utf8');self.assertEqual(graph.count('aloop=loop=-1'),1)
                self.assertIn('[1:a]asetpts=PTS-STARTPTS,aloop=',graph);self.assertIn('[2:a]asetpts=PTS-STARTPTS,atrim=',graph);self.assertNotIn('-stream_loop',spawn.call_args.args[0])
            finally:job.cancel()
        with patch('export_video.audio_loop_cost',return_value=256*1024*1024+1),patch('export_video.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(ValueError,'过长'):VideoExport(config,root,root)
            spawn.assert_not_called();self.assertFalse(list(root.glob('.*.tmp.mp4')))
    def test_export_validates_and_wires_original_range(self):
        import hashlib
        root=Path(self.temp.name);shared=root/'shared';shared.mkdir();ident='11111111-1111-4111-8111-111111111111';target=shared/(ident+'.wav');shutil.copyfile(self.file,target)
        loop={'start':2000,'end':6000,'sampleRate':self.rate,'frames':8000,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()};asset={'scope':'shared','id':ident,'extension':'.wav'}
        config={'output':str(root/'result.mp4'),'width':16,'height':16,'fps':24,'duration':1,'audio':[{'asset':asset,'start':0,'length':1,'loop':True,'originalLoop':loop}],'captions':[]};fake=MagicMock();fake.poll.return_value=None;fake.stdin.closed=False
        with patch('export_video.audio_loop_cost',return_value=1024),patch('export_video.subprocess.Popen',return_value=fake):
            job=VideoExport(config,root,root)
            try:self.assertIn('aloop=loop=-1:start=2000:size=4000',(root/'filter.txt').read_text(encoding='utf8'))
            finally:job.cancel()
        target.write_bytes(target.read_bytes()[:-1]+b'X')
        with patch('export_video.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(ValueError,'变化'):VideoExport(config,root,root)
            spawn.assert_not_called()

if __name__=='__main__':unittest.main()
