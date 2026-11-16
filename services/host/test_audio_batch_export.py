"""Compare bounded mixing against a single FFmpeg graph with artificial audio."""
import array
import shutil
import struct
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from export_video import audio_graph, reduce_audio_inputs


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is required')
class AudioBatchTests(unittest.TestCase):
    def test_recursive_mix_keeps_timing_gain_fades_offset_loop_and_rate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.wav'
            with wave.open(str(source),'wb') as wav:
                wav.setparams((2,2,48000,0,'NONE','not compressed'))
                wav.writeframes(b''.join(struct.pack('<hh',12000 if i%480<240 else -12000,6000) for i in range(24000)))
            entries=[dict(file=source,start=.1004+(i%4)*.1234,length=.6,offset=.031,
                          original_length=.6,volume=.8,fade_in=.02,fade_out=.08,
                          loop=True,original_loop=None,rate=.75 if i%2 else 1.5,loop_cost=1024)
                     for i in range(14)]
            def render(items):
                args,filters,labels=audio_graph(items,first=0)
                filters.append(''.join(labels)+f'amix=inputs={len(labels)}:normalize=0,apad,atrim=duration=1.2[out]')
                graph=root/'final.txt';graph.write_text(';'.join(filters),encoding='utf8')
                result=subprocess.run([shutil.which('ffmpeg'),'-v','error',*args,'-filter_complex_script',str(graph),'-map','[out]',
                                       '-ar','48000','-ac','2','-f','f32le','pipe:1'],capture_output=True,check=True,timeout=30,
                                      creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                samples=array.array('f');samples.frombytes(result.stdout);return samples
            expected=render(entries)
            with patch('export_video.AUDIO_BATCH_INPUTS',3):
                reduced=reduce_audio_inputs(entries,shutil.which('ffmpeg'),root)
            self.assertLessEqual(len(reduced),3)
            actual=render(reduced)
            self.assertEqual(len(actual),len(expected))
            self.assertGreater(max(expected),1, 'Fixture must detect intermediate clipping')
            differences=[(abs(a-b),i) for i,(a,b) in enumerate(zip(actual,expected))]
            maximum,index=max(differences)
            self.assertLess(maximum,.00002, f'frame={index//2} time={index/96000} actual={actual[index]} expected={expected[index]} first={next((i for d,i in differences if d>.00002),None)}')
            self.assertTrue(source.exists())
            self.assertFalse(list(root.glob('mix-0-*.wav')))


if __name__=='__main__':unittest.main()
