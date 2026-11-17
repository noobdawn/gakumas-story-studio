import ast
import json
import math
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import host
import dedicated_effects
import visual_media
from export_diagnostics import validate_gpu_frames, validate_gpu_reply, validate_gpu_video, validate_merged_frame, merged_frame_request
from export_video import VideoExport


class GpuExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gss-gpu-unit-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work = self.root / 'work'
        self.work.mkdir()
        self.input = self.root / 'export-gpu.h264'
        self.sidecar = self.root / 'export-gpu.frames.jsonl'
        self.config = dict(output=str(self.root / 'result.mp4'), width=64, height=64,
                           fps=30, duration=2, nativePostEffects=True, newOnly=True,
                           diagnosticRange=dict(startFrame=30, endFrame=33), gpuVideo=True)
        self.popen = self.enterContext(patch('export_video.subprocess.Popen'))
        self.enterContext(patch('export_video.shutil.which', return_value='ffmpeg'))
        self.popen.side_effect = self.fake_encoder

    def fake_encoder(self, args, **options):
        Path(args[-1]).write_bytes(b'mock-mp4')
        return SimpleNamespace(stdin=None, wait=lambda: 0, poll=lambda: 0)

    def job(self, config=None):
        job = VideoExport(config or self.config, self.root, self.work, gpu_input=self.input)
        self.addCleanup(job.cancel)
        return job

    def write_artifacts(self, rows=None):
        self.input.write_bytes(b'mock-h264')
        if rows is None:
            rows = [dict(index=i, timestamp=i, duration=1, timebaseNum=1, timebaseDen=30,
                         encodedTimestamp=i, bytes=10) for i in range(3)]
        self.sidecar.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')

    def accept_all(self, job):
        for n in range(1, 4):
            job.write_gpu(dict(ok=True, gpuAccepted=n, gpuCompleted=n - 1))
        job.complete_gpu(dict(ok=True, gpuAccepted=3, gpuCompleted=3))

    def test_supersampling_defaults_and_validates_before_output_creation(self):
        job=self.job();self.assertEqual(job.supersampling,1);job.cancel()
        job=self.job(dict(self.config,exportSupersampling=2));self.assertEqual(job.supersampling,2);job.cancel()
        for value in (None,True,'2',0,1.5,3,4):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'超采样'):
                self.job(dict(self.config,exportSupersampling=value))
        self.assertEqual(list(self.root.glob('.*.tmp.mp4')),[])
        self.popen.assert_not_called()

    def test_merged_mode_requires_gpu_job_and_boolean_flag(self):
        self.assertFalse(validate_merged_frame({}, False))
        self.assertTrue(validate_merged_frame({'mergedFrame': True}, True))
        for value, gpu in [(True, False), (1, True), ('true', True), (None, True)]:
            with self.subTest(value=value, gpu=gpu), self.assertRaises(ValueError):
                validate_merged_frame({'mergedFrame': value}, gpu)

    def test_normal_gpu_requires_full_native_queue_but_supports_existing_destination(self):
        config=dict(exportMode='gpu',gpuVideo=True,mergedFrame=True,queueCapacity=8,newOnly=False)
        self.assertTrue(validate_gpu_video(config,True,False,37951))
        for change in (dict(queueCapacity=4),dict(queueCapacity=True),dict(mergedFrame=False),dict(gpuVideo=False),dict(fullProject=True),dict(diagnosticRange=dict(startFrame=0,endFrame=30)),dict(exportMode='bad'),dict(exportMode='compatibility')):
            with self.subTest(change=change),self.assertRaises(ValueError):
                validate_gpu_video(dict(config,**change),True,False,37951)
        for native,ui,frames in ((False,False,30),(True,True,30),(True,False,216001)):
            with self.assertRaises(ValueError):validate_gpu_video(config,native,ui,frames)

    def test_normal_gpu_cancel_preserves_existing_output(self):
        config=dict(self.config,exportMode='gpu',diagnosticRange=None,mergedFrame=True,queueCapacity=8,newOnly=False)
        output=Path(config['output']);output.write_bytes(b'user-existing-video')
        job=self.job(config)
        self.assertEqual(job.frames,60);self.assertEqual(job.start_frame,0)
        self.assertTrue(job.gpu_video);self.assertEqual(job.queue_capacity,8)
        job.cancel()
        self.assertEqual(output.read_bytes(),b'user-existing-video')
        self.assertFalse(job.temp.exists())

    def test_merged_packet_preserves_state_but_host_owns_frame_identity(self):
        state = dict(kind='gpu-export-cancel', token='untrusted', exportIndex=99,
                     gpuVideo=False, frameWidth=16, sceneId='trainingroom')
        frame = dict(kind='frame', token='test', exportIndex=3, gpuVideo=True, frameWidth=1920)
        packet = merged_frame_request(state, frame, True)
        self.assertEqual(packet, dict(frame, kind='state-frame', sceneId='trainingroom'))
        self.assertEqual(state['kind'], 'gpu-export-cancel')
        for supplied, enabled in [(None, True), ([], True), (state, False)]:
            with self.subTest(enabled=enabled), self.assertRaises(ValueError):
                merged_frame_request(supplied, frame, enabled)

    def test_delays_mux_and_copies_video_after_completed_frames(self):
        job = self.job()
        self.popen.assert_not_called()
        self.assertIsNone(job.proc)
        with self.assertRaisesRegex(ValueError, 'PNG'):
            job.write(b'png')
        self.accept_all(job)
        self.write_artifacts()
        job.finish()
        command = self.popen.call_args.args[0]
        self.assertEqual(command[5:13], ['-fflags', '+genpts', '-r', '30', '-f', 'h264', '-i', str(self.input.resolve())])
        self.assertEqual(command[command.index('-c:v') + 1], 'copy')
        self.assertNotIn('libx264', command)
        self.assertNotIn('pipe:0', command)
        self.assertNotIn('-frames:v', command)  # streamcopy must not truncate delayed audio
        self.assertEqual((self.root / 'result.mp4').read_bytes(), b'mock-mp4')
        self.assertFalse(self.input.exists())
        self.assertFalse(self.sidecar.exists())

    def test_audio_filter_retains_source_range_and_local_timestamp(self):
        config = dict(self.config, audio=[dict(asset={}, start=1, length=.1)])
        with patch('export_video.audio_file', return_value=self.root / 'voice.wav'):
            job = self.job(config)
        filters = (self.work / 'filter.txt').read_text(encoding='utf-8')
        self.assertIn('atrim=start=1.000000000:end=1.100000000,asetpts=N/SR/TB', filters)
        self.assertIn('-c:a', job.encode_args)
        self.assertEqual(job.encode_args[job.encode_args.index('-c:v') + 1], 'copy')
        self.popen.assert_not_called()

    def test_mode_rejects_normal_export_and_nonboolean_flag(self):
        for changes in (dict(newOnly=False), dict(diagnosticRange=None), dict(nativePostEffects=False),
                        dict(nativeUI=True), dict(gpuVideo=1)):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.job(dict(self.config, **changes))
        self.assertFalse(list(self.root.glob('.*.tmp.mp4')))
        self.assertFalse(validate_gpu_video({}, True, False, 3))

    def test_acceptance_count_and_completion_must_be_monotonic(self):
        job = self.job()
        for reply in (dict(ok=True, gpuAccepted=2, gpuCompleted=0),
                      dict(ok=True, gpuAccepted=True, gpuCompleted=0),
                      dict(ok=True, gpuAccepted=1, gpuCompleted=2), dict(ok=False, error='encode failed')):
            with self.subTest(reply=reply), self.assertRaises((ValueError, RuntimeError)):
                job.write_gpu(reply)
            self.assertEqual(job.count, 0)
        job.write_gpu(dict(ok=True, gpuAccepted=1, gpuCompleted=1))
        with self.assertRaises(ValueError):
            job.write_gpu(dict(ok=True, gpuAccepted=2, gpuCompleted=0))
        with self.assertRaises(ValueError):
            job.complete_gpu(dict(ok=True, gpuAccepted=1, gpuCompleted=1))
        with self.assertRaises(ValueError):
            validate_gpu_reply(dict(ok=True, gpuAccepted=3, gpuCompleted=2), 3, final=True)

    def test_sidecar_requires_every_local_frame_and_timestamp_once(self):
        for changes in ({'index': 1}, {'timestamp': 1}, {'duration': 2}, {'timebaseNum': 0},
                        {'timebaseDen': 24}, {'encodedTimestamp': 1}, {'index': False}):
            rows = [dict(index=0, timestamp=0, duration=1, timebaseNum=1, timebaseDen=30)]
            rows[0].update(changes)
            self.write_artifacts(rows)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_gpu_frames(self.sidecar, 1, 30)
        self.write_artifacts()
        self.assertEqual(validate_gpu_frames(self.sidecar, 3, 30), 3)
        for count in (2, 4):
            with self.assertRaises(ValueError):validate_gpu_frames(self.sidecar, count, 30)

    def test_invalid_sidecar_never_starts_mux_and_cancel_cleans(self):
        job = self.job()
        self.accept_all(job)
        self.write_artifacts([])
        with self.assertRaisesRegex(ValueError, '不完整'):job.finish()
        self.popen.assert_not_called()
        job.cancel()
        self.assertFalse(self.input.exists())
        self.assertFalse(self.sidecar.exists())
        self.assertFalse(list(self.root.glob('.*.tmp.mp4')))

    def test_existing_inputs_and_racing_destination_are_preserved(self):
        self.input.write_bytes(b'pre-existing')
        with self.assertRaisesRegex(ValueError, '已存在'):self.job()
        self.assertEqual(self.input.read_bytes(), b'pre-existing')
        self.input.unlink()
        job = self.job()
        self.accept_all(job)
        self.write_artifacts()
        destination = self.root / 'result.mp4'
        destination.write_bytes(b'user output')
        with self.assertRaisesRegex(RuntimeError, '目标文件'):job.finish()
        job.cancel()
        self.assertEqual(destination.read_bytes(), b'user output')

    def handler(self, fail_frame=False):
        # Exercise the real nested HTTP route code without a server, app or Player.
        tree = ast.parse(Path(host.__file__).read_text(encoding='utf-8'))
        wanted = ('gpu_export_command', 'cancel_export', 'Handler')
        nodes = {node.name: node for node in ast.walk(tree)
                 if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in wanted}
        factory = ast.parse('def make_handler():\n export_job=None\n export_dir=None\n').body[0]
        factory.body += [nodes[name] for name in wanted]
        factory.body += ast.parse('return Handler').body
        module = ast.fix_missing_locations(ast.Module(body=[factory], type_ignores=[]))
        player = self.root / 'Player.exe'
        for marker in ('creator-gpu-export-v1', 'creator-post-effects-v1', 'creator-export-profile-v1', 'creator-merged-export-v1', 'creator-queued-export-v1'):
            (self.root / marker).touch()
        commands = []
        pending = []
        queued=[]
        def sendall(data):
            request = json.loads(data)
            commands.append(request)
            kind = request.get('kind')
            if kind == 'gpu-export-start':reply = dict(ok=True, gpuAccepted=0, gpuCompleted=0)
            elif kind in ('frame', 'state-frame'):
                n = request['exportIndex'] + 1
                reply = dict(ok=False, error='GPU failed') if fail_frame else dict(ok=True, gpuAccepted=n, gpuCompleted=n)
            elif kind == 'gpu-export-enqueue':
                queued.extend(request['queueFrames'])
                n=len(queued)
                reply=dict(ok=True,queueSession=request['queueSession'],queueAdmitted=True,queueEnqueued=n,
                           queueSubmitted=0,queueReported=0,queuePendingBytes=100,queueResults=[])
            elif kind == 'gpu-export-status':
                n=len(queued)
                reply=dict(ok=True,queueSession=request['queueSession'],queueAdmitted=False,queueEnqueued=n,
                           queueSubmitted=n,queueReported=n,queuePendingBytes=0,
                           queueResults=[dict(ok=True,gpuAccepted=i+1,gpuCompleted=i) for i in range(n)])
            elif kind == 'gpu-export-finish':
                self.write_artifacts()
                reply = dict(ok=True, gpuAccepted=3, gpuCompleted=3)
            else:reply = dict(ok=True)
            pending.append(json.dumps(reply).encode())
        scope = dict(Path=Path, json=json, time=time, tempfile=tempfile, lock=threading.RLock(),
                     conn=SimpleNamespace(sendall=sendall), stream=SimpleNamespace(readline=lambda n: pending.pop(0)),
                     token='test', origin='local', PreviewRequestHandler=host.PreviewRequestHandler,
                     export_capable=True, player=player, output=self.root, library_root=self.root,
                     ui_graph_capable=True, game_dialogue=False, args=SimpleNamespace(dialogue_assets=None),
                     dedicated_effects=dedicated_effects, visual_media=visual_media)
        exec(compile(module, str(Path(host.__file__)), 'exec'), scope)
        cls = scope['make_handler']()
        handler = cls.__new__(cls)
        handler.headers = {'Origin': 'local'}
        def request(endpoint, message):
            response = []
            handler.path = '/test/' + endpoint
            handler.read_json = lambda limit: dict(message)
            handler.send_json = lambda value, status=200: response.append((value, status))
            handler.do_POST()
            return response[0]
        return request, commands

    def test_host_merged_frame_uses_one_validated_command_and_finishes(self):
        request, commands = self.handler()
        reply, status = request('export-start', dict(self.config, mergedFrame=True))
        self.assertEqual(status, 200)
        self.assertTrue(reply['mergedFrame'])
        for i in range(3):
            reply, status = request('export-frame', dict(index=i, state=dict(sceneId='trainingroom', mediaDraws=[], kind='gpu-export-cancel', token='bad', exportIndex=99)))
            self.assertEqual(status, 200, reply)
            self.assertEqual(commands[-1]['kind'], 'state-frame')
            self.assertEqual(commands[-1]['token'], 'test')
            self.assertEqual(commands[-1]['exportIndex'], i)
            self.assertEqual(commands[-1]['sceneId'], 'trainingroom')
        self.assertEqual(request('export-finish', {})[1], 200)
        self.assertEqual([r['kind'] for r in commands], ['gpu-export-start']+['state-frame']*3+['gpu-export-finish'])

    def test_host_queue_admission_drain_finish_and_stale_cancel(self):
        request, commands=self.handler()
        reply,status=request('export-start',dict(self.config,mergedFrame=True,queueCapacity=4))
        self.assertEqual(status,200,reply);session=reply['queueSession']
        # A delayed request from another export must not cancel this one.
        self.assertEqual(request('export-cancel',dict(queueSession='old'))[1],502)
        self.assertEqual(len(commands),1)
        rows=[dict(index=i,state=dict(sceneId='trainingroom')) for i in range(3)]
        reply,status=request('export-enqueue',dict(queueSession=session,frames=rows))
        self.assertEqual(status,200,reply);self.assertEqual(reply['queueReported'],0)
        self.assertEqual(commands[-1]['queueFrames'][2]['frameIndex'],32)
        reply,status=request('export-status',dict(queueSession=session))
        self.assertEqual(status,200,reply);self.assertEqual(reply['queueReported'],3)
        reply,status=request('export-finish',dict(queueSession=session))
        self.assertEqual(status,200,reply);self.assertTrue((self.root/'result.mp4').exists())

    def test_host_missing_merged_state_cancels_without_submitting_frame(self):
        request, commands = self.handler()
        self.assertEqual(request('export-start', dict(self.config, mergedFrame=True))[1], 200)
        self.assertEqual(request('export-frame', dict(index=0))[1], 502)
        self.assertEqual([r['kind'] for r in commands], ['gpu-export-start', 'gpu-export-cancel'])

    def test_host_gpu_lifecycle_ignores_untrusted_paths_and_png_requests(self):
        request, commands = self.handler()
        reply, status = request('export-start', dict(self.config, gpuInput='untrusted'))
        self.assertEqual(status, 200)
        self.assertTrue(reply['gpuVideo'])
        for i in range(3):
            reply, status = request('export-frame', dict(index=i, gpuVideo=False, frameDigest=True, referenceFrame=True))
            self.assertEqual(status, 200)
            self.assertNotIn('pngSha256', reply)
            self.assertTrue(commands[-1]['gpuVideo'])
            self.assertEqual(commands[-1]['exportIndex'], i)
        reply, status = request('export-finish', {})
        self.assertEqual(status, 200)
        self.assertEqual(reply['gpuCompleted'], 3)
        self.assertEqual([row['kind'] for row in commands], ['gpu-export-start', 'frame', 'frame', 'frame', 'gpu-export-finish'])
        self.assertFalse(self.input.exists())

    def test_host_failure_cancels_native_session_before_cleanup(self):
        request, commands = self.handler(fail_frame=True)
        self.assertEqual(request('export-start', self.config)[1], 200)
        self.write_artifacts([])
        reply, status = request('export-frame', dict(index=0))
        self.assertEqual(status, 502)
        self.assertIn('GPU failed', reply['error'])
        self.assertEqual(commands[-1]['kind'], 'gpu-export-cancel')
        self.assertFalse(self.input.exists())
        self.assertFalse(self.sidecar.exists())
        self.assertEqual(request('export-cancel', {})[1], 200)

    def test_host_duplicate_start_keeps_active_job_and_cancel_allows_restart(self):
        request, commands = self.handler()
        self.assertEqual(request('export-start', self.config)[1], 200)
        self.assertEqual(request('export-start', self.config)[1], 502)
        self.assertEqual([row['kind'] for row in commands], ['gpu-export-start'])
        self.write_artifacts([])
        self.assertEqual(request('export-cancel', {})[1], 200)
        self.assertEqual(commands[-1]['kind'], 'gpu-export-cancel')
        self.assertEqual(request('export-start', self.config)[1], 200)
        self.assertEqual(request('export-cancel', {})[1], 200)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is required')
class GpuMuxIntegrationTest(unittest.TestCase):
    def test_fast_h264_copy_keeps_audio_trimmed_from_nonzero_source_frame(self):
        # Artificial CPU-encoded input tests muxing only, never Unity/GPU speed.
        ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
        with tempfile.TemporaryDirectory(prefix='gss-gpu-mux-') as temporary:
            root = Path(temporary)
            work = root / 'work'; work.mkdir()
            shared = root / 'shared'; shared.mkdir()
            audio_id = '16679d9f-0075-4f97-b570-fb82dfdce722'
            with wave.open(str(shared / (audio_id + '.wav')), 'wb') as output:
                output.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
                output.writeframes(b''.join(struct.pack('<h', round(10000 * math.sin(i * 2 * math.pi * 440 / 48000)))
                                           for i in range(24000)))
            source = root / 'export-gpu.h264'
            destination = root / 'result.mp4'
            config = dict(output=str(destination), width=64, height=64, fps=30, duration=32,
                          nativePostEffects=True, newOnly=True, gpuVideo=True,
                          diagnosticRange=dict(startFrame=900, endFrame=930),
                          audio=[dict(asset=dict(scope='shared', id=audio_id, extension='.wav'),
                                      start=30.25, length=.5)])
            job = VideoExport(config, root, work, gpu_input=source)
            try:
                # No B frames, local timestamps 0..29 and a one-second CFR stream.
                subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
                                'color=c=blue:s=64x64:r=30', '-frames:v', '30', '-c:v', 'libx264',
                                '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p', '-f', 'h264', str(source)],
                               check=True, capture_output=True, timeout=30,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                rows = [dict(index=i, timestamp=i, duration=1, timebaseNum=1, timebaseDen=30) for i in range(30)]
                job.gpu_sidecar.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
                for n in range(1, 31):job.write_gpu(dict(ok=True, gpuAccepted=n, gpuCompleted=n))
                job.complete_gpu(dict(ok=True, gpuAccepted=30, gpuCompleted=30))
                job.finish()
            finally:
                job.cancel()
            probe = subprocess.run([ffprobe, '-v', 'error', '-count_frames', '-show_entries',
                                    'stream=codec_type,codec_name,nb_read_frames,avg_frame_rate,duration,start_time,has_b_frames:format=duration',
                                    '-of', 'json', str(destination)], check=True, capture_output=True, timeout=30,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            info = json.loads(probe.stdout)
            streams = {stream['codec_type']: stream for stream in info['streams']}
            self.assertEqual(set(streams), {'video', 'audio'})
            self.assertEqual(streams['video']['codec_name'], 'h264')
            self.assertEqual(streams['video']['has_b_frames'], 0)
            self.assertEqual(int(streams['video']['nb_read_frames']), 30)
            self.assertEqual(streams['video']['avg_frame_rate'], '30/1')
            self.assertEqual(streams['audio']['codec_name'], 'aac')
            self.assertGreater(int(streams['audio']['nb_read_frames']), 0)
            for stream in streams.values():
                self.assertAlmostEqual(float(stream['start_time']), 0, delta=1 / 30)
                self.assertAlmostEqual(float(stream['duration']), 1, delta=1 / 30)
            self.assertAlmostEqual(float(info['format']['duration']), 1, delta=1 / 30)
            decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(destination), '-map', '0:a:0',
                                      '-ar', '48000', '-ac', '1', '-f', 's16le', 'pipe:1'],
                                     check=True, capture_output=True, timeout=30,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
            pcm = struct.unpack('<' + str(len(decoded) // 2) + 'h', decoded)
            self.assertGreaterEqual(len(pcm), 48000)
            self.assertLessEqual(len(pcm), 48000 + 1024)  # AAC tail padding
            self.assertLess(max(abs(x) for x in pcm[:7200]), 100)
            self.assertGreater(max(abs(x) for x in pcm[16800:31200]), 3000)
            self.assertLess(max(abs(x) for x in pcm[43200:48000]), 100)


if __name__ == '__main__':
    unittest.main()
