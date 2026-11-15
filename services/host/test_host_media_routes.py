import unittest
from host import media_request_parts


class MediaRequestTests(unittest.TestCase):
    def test_probe_query_preserves_media_path_validation(self):
        prefix='/token/media/'
        project='12345678-1234-4123-8123-123456789abc'
        audio='abcdefab-cdef-4abc-8def-abcdefabcdef.wav'
        path=prefix+'project/'+project+'/'+audio
        self.assertEqual(media_request_parts(path,prefix),['project',project,audio])
        self.assertEqual(media_request_parts(path+'?probe=1',prefix),['project',project,audio])
        self.assertEqual(media_request_parts(prefix+'shared/shared/'+audio+'?probe=2',prefix),['shared','shared',audio])
        for bad in (path+'/extra?probe=1',prefix+'project/../../'+audio+'?probe=1',prefix+'shared/wrong/'+audio,
                    prefix+'project/'+project+'/secret.exe?x=1','/other/media/project/'+project+'/'+audio):
            self.assertIsNone(media_request_parts(bad,prefix))


if __name__=='__main__':unittest.main()
