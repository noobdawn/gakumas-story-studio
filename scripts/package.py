"""Build a portable folder from explicit, reviewed runtime inputs."""
import argparse, hashlib, json, shutil, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--python',type=Path,required=True);ap.add_argument('--tools',type=Path,required=True);ap.add_argument('--player',type=Path,default=ROOT/'runtime/player');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
    output=a.output.resolve()
    if any(p.exists() for p in [output,Path(str(output)+'.zip'),Path(str(output)+'.zip.sha256')]):raise SystemExit('Output or archive already exists')
    if not (a.python/'python.exe').is_file() or not list(a.python.glob('python*._pth')):raise SystemExit('Use a prepared portable CPython runtime, not a venv')
    for filename in ['ffmpeg.exe','ffprobe.exe','vgmstream-cli.exe']:
        if not (a.tools/filename).is_file():raise SystemExit('Missing tool: '+filename)
    if not (a.tools/'THIRD_PARTY_NOTICES.txt').is_file():raise SystemExit('Runtime tools require redistribution notices')
    if not (a.player/'creator-dedicated-effects-v2').is_file():raise SystemExit('Player lacks dedicated effects contract')
    electron=ROOT/'apps/desktop/electron/node_modules/electron/dist'
    for source in [electron,a.python,a.tools,a.player,ROOT/'apps',ROOT/'services',ROOT/'resources']:
        if output==source.resolve() or source.resolve() in output.parents:raise SystemExit('Output must be outside all runtime/source inputs')
    shutil.copytree(electron,output);(output/'electron.exe').rename(output/'GSS.exe')
    def ignore(directory,names):return [n for n in names if n in ['node_modules','tests','__pycache__'] or n.startswith('test_') or n.endswith('.pyc')]
    for folder in ['apps','services','resources/common','resources/voicevox','docs']:
        shutil.copytree(ROOT/folder,output/folder,ignore=ignore)
    for folder,source in [('runtime/python',a.python),('runtime/tools',a.tools),('runtime/player',a.player)]:shutil.copytree(source,output/folder)
    app=output/'resources/app';app.mkdir(exist_ok=True)
    (app/'package.json').write_text(json.dumps({'name':'gakumas-story-studio','version':json.loads((ROOT/'apps/desktop/electron/package.json').read_text())['version'],'main':'../../apps/desktop/electron/main.js'}),'utf-8')
    for file in ['README.md','LICENSE','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','release-policy.json']:shutil.copy2(ROOT/file,output/file)
    hashes={p.relative_to(output).as_posix():hashlib.file_digest(p.open('rb'),'sha256').hexdigest() for p in output.rglob('*') if p.is_file()}
    (output/'manifest-sha256.json').write_text(json.dumps(hashes,indent=2),'utf-8')
    archive=Path(shutil.make_archive(str(output),'zip',root_dir=output.parent,base_dir=output.name))
    archive.with_suffix('.zip.sha256').write_text(hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()+'  '+archive.name+'\n','utf-8')
    print(archive)
if __name__=='__main__':main()
