import copy
import unittest
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from export_queue import capacity, frames, consume, require_session


class ExportQueueTest(unittest.TestCase):
    def test_full_project_requires_opt_in_complete_range_and_bounded_queue(self):
        from export_diagnostics import sample_range,validate_gpu_video
        config=dict(fullProject=True,gpuVideo=True,mergedFrame=True,queueCapacity=8,newOnly=True,diagnosticRange=dict(startFrame=0,endFrame=37951))
        self.assertEqual(sample_range(config,37951,True),(0,37951))
        self.assertTrue(validate_gpu_video(config,True,False,37951))
        for changes in (dict(fullProject=False),dict(fullProject=1),dict(queueCapacity=1),dict(queueCapacity=True),dict(mergedFrame=False),dict(gpuVideo=False),dict(newOnly=False),dict(diagnosticRange=None),dict(diagnosticRange=dict(startFrame=1,endFrame=37951))):
            with self.subTest(changes=changes),self.assertRaises(ValueError):sample_range(dict(config,**changes),37951,True)
        with self.assertRaises(ValueError):sample_range(dict(config,diagnosticRange=dict(startFrame=0,endFrame=216001)),216001,True)

    def test_full_project_sidecar_streams_past_old_file_limit_and_checks_tail(self):
        from export_diagnostics import validate_gpu_frames
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'frames.jsonl'
            def write(bad=False):
                with path.open('w',encoding='utf-8') as stream:
                    for i in range(37951):stream.write(json.dumps(dict(index=i,timestamp=i+(1 if bad and i==37950 else 0),duration=1,timebaseNum=1,timebaseDen=30,bytes=100))+'\n')
            write();self.assertGreater(path.stat().st_size,1024*1024)
            self.assertEqual(validate_gpu_frames(path,37951,30),37951)
            write(True)
            with self.assertRaises(ValueError):validate_gpu_frames(path,37951,30)

    def job(self):
        j=SimpleNamespace(queue_capacity=4,queue_session='a'*32,queue_enqueued=0,count=0,
            supersampling=2,gpu_completed=0,frames=9,width=1920,height=1080,native_post=True,profile=True,start_frame=900,run_id='test')
        def write(row):j.count+=1;j.gpu_completed=row['gpuCompleted']
        j.write_gpu=write
        return j

    def test_long_probe_stays_bounded_and_requires_merged_gpu(self):
        from export_diagnostics import sample_range,validate_gpu_video
        config=dict(gpuVideo=True,mergedFrame=True,newOnly=True,diagnosticRange=dict(startFrame=0,endFrame=1800))
        self.assertEqual(sample_range(config,3000,True),(0,1800))
        self.assertTrue(validate_gpu_video(config,True,False,1800))
        for change in (dict(gpuVideo=False),dict(mergedFrame=False),dict(newOnly=False),dict(diagnosticRange=dict(startFrame=0,endFrame=1801))):
            with self.assertRaises(ValueError):sample_range(dict(config,**change),3000,True)
        with self.assertRaises(ValueError):validate_gpu_video(config,True,False,1801)

    def test_mode_and_stale_sessions(self):
        for v in (True,2,16,None,'4'):
            with self.assertRaises(ValueError):capacity({'queueCapacity':v},True)
        with self.assertRaises(ValueError):capacity({'queueCapacity':4},False)
        self.assertEqual(capacity({'queueCapacity':8},True),8)
        with self.assertRaises(ValueError):require_session(self.job(),{'queueSession':'old'})

    def test_host_owns_identity_and_validates_all_frames_before_send(self):
        j=self.job();state=dict(token='bad',kind='gpu-export-cancel',exportIndex=99,queueFrames=[{}],frameWidth=16,frameSupersampling=99)
        rows=[dict(index=i,state=state) for i in range(2)]
        message=dict(queueSession=j.queue_session,frames=rows)
        result=frames(j,message,'auth',lambda p:p.update(mediaDraws=[]))
        self.assertEqual([r['exportIndex'] for r in result],[0,1]);self.assertEqual([r['frameIndex'] for r in result],[900,901])
        self.assertTrue(all(r['token']=='auth' and r['queueFrames'] is None and r['frameWidth']==1920 and r['frameSupersampling']==2 for r in result))
        self.assertEqual(state['token'],'bad')
        rows[1]['index']=0
        with self.assertRaises(ValueError):frames(j,message,'auth',lambda p:None)
        self.assertEqual(j.queue_enqueued,0)

    def test_admission_is_not_completion_and_bad_reply_is_atomic(self):
        j=self.job();reply=dict(ok=True,queueSession=j.queue_session,queueAdmitted=True,
            queueEnqueued=4,queueSubmitted=0,queueReported=0,queuePendingBytes=100,queueResults=[])
        consume(j,reply,4);self.assertEqual((j.queue_enqueued,j.count),(4,0))
        response=dict(reply,queueAdmitted=False,queueSubmitted=2,queueReported=2,queueResults=[
            dict(ok=True,gpuAccepted=1,gpuCompleted=0),dict(ok=True,gpuAccepted=2,gpuCompleted=1)])
        bad=copy.deepcopy(response);bad['queueResults'][1]['gpuAccepted']=3
        with self.assertRaises(ValueError):consume(j,bad,0)
        self.assertEqual((j.count,j.gpu_completed),(0,0))
        consume(j,response,0);self.assertEqual((j.count,j.gpu_completed),(2,1))
        with self.assertRaises(ValueError):consume(j,response,0)

    def test_backpressure_does_not_advance_and_size_or_credits_are_checked(self):
        j=self.job();reply=dict(ok=True,queueSession=j.queue_session,queueAdmitted=False,queueEnqueued=0,
            queueSubmitted=0,queueReported=0,queuePendingBytes=0,queueResults=[])
        consume(j,reply,4);self.assertEqual(j.queue_enqueued,0)
        for changes in (dict(queuePendingBytes=2097153),dict(queueEnqueued=5,queueAdmitted=True),dict(queueSubmitted=True)):
            with self.assertRaises(ValueError):consume(j,dict(reply,**changes),4)

if __name__=='__main__':unittest.main()
