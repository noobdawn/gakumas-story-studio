import unittest
from types import SimpleNamespace as NS
from voicevox_timing import extract

class TimingTest(unittest.TestCase):
    def test_pause_consonants_and_question_extension(self):
        mora=NS(consonant='k',consonant_length=.1,vowel='a',vowel_length=.2,pitch=5)
        pause=NS(consonant=None,consonant_length=None,vowel='pau',vowel_length=.1)
        query=NS(speed_scale=1,pre_phoneme_length=.1,post_phoneme_length=.2,accent_phrases=[NS(moras=[mora],is_interrogative=True,pause_mora=pause)])
        data=extract(query,100)
        self.assertEqual(data['frameCount'],85)
        self.assertEqual([(x['phoneme'],x['startFrame'],x['endFrame']) for x in data['phonemes']],[('k',10,20),('a',20,40),('a',40,55),('pau',55,65)])

    def test_bad_rate_and_frame_count_rejected(self):
        query=NS(speed_scale=1,pre_phoneme_length=0,post_phoneme_length=0,accent_phrases=[],frame_length=lambda:1)
        with self.assertRaises(ValueError):extract(query,100)
        query.speed_scale=0
        with self.assertRaises(ValueError):extract(query,100)

if __name__=='__main__':unittest.main()
