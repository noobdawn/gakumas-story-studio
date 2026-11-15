"""Verify the portable bundle without opening the editor or reading game data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('package',type=Path)
    args=parser.parse_args()
    root=args.package.resolve()
    manifest=json.loads((root/'manifest-sha256.json').read_text('utf-8'))
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    assert actual==set(manifest)|{'manifest-sha256.json'}, 'Unexpected package contents'
    for name,digest in manifest.items():
        file=(root/name).resolve()
        assert root in file.parents and not (root/name).is_symlink(),name
        with file.open('rb') as stream:
            assert hashlib.file_digest(stream,'sha256').hexdigest()==digest,name
    with tempfile.TemporaryDirectory(prefix='gss-package-check-') as temporary:
        env={k:v for k,v in os.environ.items() if not k.startswith('CREATOR_')}
        env['CREATOR_LIBRARY_DIR']=temporary
        env['PYTHONUTF8']='1'
        py=root/'runtime/python/python.exe'
        subprocess.run([str(py),'-B','-X','utf8','-c','import UnityPy,PIL,cryptography,numpy,pydantic,runtime_paths,resource_catalog,export_video; print("Bundled Python and host imports passed")'],cwd=temporary,env=env,check=True)
        env['ELECTRON_RUN_AS_NODE']='1'
        marker=Path(temporary)/'electron-check.txt'
        code="const path=require('node:path'),assert=require('node:assert/strict');const root=process.argv[1];const r=require(path.join(root,'apps/desktop/electron/runtime-paths'));r.configure();assert.equal(r.root,root);assert.equal(r.python(),path.join(root,'runtime/python/python.exe'));require(path.join(root,'apps/desktop/electron/setup-wizard'));require('node:fs').writeFileSync(process.argv[2],'passed');"
        subprocess.run([str(root/'GSS.exe'),'-e',code,str(root),str(marker)],cwd=temporary,env=env,check=True,timeout=30)
        assert marker.read_text()=='passed', 'Electron runtime check did not execute'
    print(json.dumps({'files':len(manifest),'hashes':'passed','portableImports':'passed','visibleUI':'not tested'}))

if __name__=='__main__':
    main()
