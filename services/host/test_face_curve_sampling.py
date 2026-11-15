import struct
import unittest
from face_curve_sampling import decode_stream, sample_curve, sample_dense, simplify_keys

def bits(value): return struct.unpack('<I',struct.pack('<f',value))[0]

class FaceCurveSamplingTest(unittest.TestCase):
    def test_streamed_cubic_and_separate_curves(self):
        words=[bits(0),2, 0,bits(0),bits(0),bits(2),bits(3), 1,bits(0),bits(0),bits(0),bits(7),
               bits(1),1, 0,bits(0),bits(0),bits(0),bits(5)]
        curves=decode_stream(words,2)
        self.assertEqual(sample_curve(curves[0],.5),4)
        self.assertEqual(sample_curve(curves[0],1),5)
        self.assertEqual(sample_curve(curves[1],.5),7)

    def test_rejects_truncated_and_duplicate_frames(self):
        with self.assertRaises(ValueError): decode_stream([bits(0),1,0],1)
        with self.assertRaises(ValueError): decode_stream([bits(0),2]+[0]*10,1)

    def test_dense_frame_major_interpolation(self):
        samples=[0,10, 2,20, 4,30]
        self.assertEqual(sample_dense(samples,2,3,2,0,1,.25),15)
        self.assertEqual(sample_dense(samples,2,3,2,0,0,2),4)
        with self.assertRaises(ValueError): sample_dense(samples[:-1],2,3,2,0,0,0)

    def test_key_reduction_bounds_sample_error(self):
        keys=[{'time':i/30,'value':float(min(i%18,18-i%18))} for i in range(90)]
        reduced=simplify_keys(keys,.15)
        self.assertLess(len(reduced),len(keys))
        for k in keys:
            left=max((x for x in reduced if x['time']<=k['time']),key=lambda x:x['time'])
            right=min((x for x in reduced if x['time']>=k['time']),key=lambda x:x['time'])
            expected=left['value'] if left==right else left['value']+(right['value']-left['value'])*(k['time']-left['time'])/(right['time']-left['time'])
            self.assertLessEqual(abs(expected-k['value']),.150001)

if __name__=='__main__': unittest.main()
