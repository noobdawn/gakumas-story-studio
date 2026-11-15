import unittest

from host import face_catalog


class FaceCatalogTest(unittest.TestCase):
    def test_character_specific_controls_and_missing_shapes(self):
        names, missing = face_catalog({
            'ttmr': {'b_mouth.mouth_001', 'b_eye.eye_001', 'custom_Geo_Head_0'},
            'hume': {'b_mouth.mouth_001', 'b_eye.eye_001', 'b_eye.eye_201'},
            'nasr': {'b_mouth.mouth_001', 'b_brow.brow_008'},
        })
        self.assertEqual(names, ['b_brow.brow_008', 'b_eye.eye_001', 'b_eye.eye_201', 'b_mouth.mouth_001'])
        self.assertIn('ttmr:b_eye.eye_201', missing)
        self.assertIn('hume:b_brow.brow_008', missing)
        self.assertIn('nasr:b_eye.eye_001', missing)
        self.assertNotIn('hume:b_eye.eye_201', missing)
        self.assertNotIn('ttmr:b_mouth.mouth_001', missing)

    def test_empty_catalog_and_invalid_names(self):
        self.assertEqual(face_catalog({}), ([], []))
        self.assertEqual(face_catalog({'ttmr': [None, '', 'b_eye.eye_001,evil', 'side090']}), ([], []))


if __name__ == '__main__':
    unittest.main()
