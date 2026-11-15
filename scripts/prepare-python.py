"""Prepare the hash-pinned embeddable Python runtime for a portable release."""
import argparse,hashlib,json,subprocess,sys,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);ap.add_argument('--archive',type=Path);a=ap.parse_args()
if a.output.exists():raise SystemExit('Output exists')
record=json.loads((ROOT/'resources/python-runtime.json').read_text())
data=a.archive.read_bytes() if a.archive else urllib.request.urlopen(record['url'],timeout=120).read()
if hashlib.sha256(data).hexdigest()!=record['sha256']:raise SystemExit('Python archive hash mismatch')
import io
with zipfile.ZipFile(io.BytesIO(data)) as z:
    for n in z.namelist():
        if a.output.resolve() not in (a.output/n).resolve().parents:raise ValueError('Unsafe archive')
    z.extractall(a.output)
pth=next(a.output.glob('python*._pth'));pth.write_text('python314.zip\n.\nLib/site-packages\n../../services/host\n../../services/importer\n../../services/voice\nimport site\n','utf-8')
subprocess.run([sys.executable,'-m','pip','install','--prefer-binary','--cache-dir',str(ROOT/'.local/pip-cache'),'--target',str(a.output/'Lib/site-packages'),'-r',str(ROOT/'requirements-lock.txt')],check=True)
subprocess.run([str(a.output/'python.exe'),'-c','import UnityPy, PIL, cryptography, numpy, pydantic;print("Portable runtime ready")'],check=True)
