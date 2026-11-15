import io, tempfile, unittest, zipfile
from pathlib import Path
from install_voicevox import unpack

class ArchiveTests(unittest.TestCase):
    def test_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=root/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('../outside','no')
            with self.assertRaises(ValueError):unpack(archive,root/'out','zip')
            self.assertFalse((root/'outside').exists())

    def test_regular_wheel_files_extract(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=root/'good.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('module/__init__.py','fixture')
            unpack(archive,root/'out','zip')
            self.assertEqual((root/'out/module/__init__.py').read_text(),'fixture')

if __name__=='__main__':unittest.main()
