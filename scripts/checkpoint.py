"""Save a local source checkpoint and retain at most three dev/* branch refs."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]

def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True,encoding='utf-8').strip()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--message',required=True)
    args=parser.parse_args()
    if git('rev-parse','--show-toplevel').replace('\\','/').lower()!=ROOT.as_posix().lower():
        raise SystemExit('Run inside the dedicated source repository')
    files=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0')
    forbidden={'build','dist','runtime','node_modules','Library','.venv','user-library'}
    for name in filter(None,files):
        p=Path(name)
        if p.parts[0] in {'build','dist','runtime'} or any(x in forbidden-{'runtime'} for x in p.parts):
            raise SystemExit('Generated/user data must not enter source history: '+name)
        if (ROOT/p).is_file() and (ROOT/p).stat().st_size>10*1024**2:
            raise SystemExit('Review large file before checkpoint: '+name)
    git('add','--all')
    if git('diff','--cached','--name-only'):
        git('commit','--quiet','-m',args.message)
    revision=git('rev-parse','HEAD')
    branch='dev/'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    git('branch',branch,revision)
    current=git('branch','--show-current')
    refs=[]
    for line in git('for-each-ref','--format=%(committerdate:unix) %(refname:short)','refs/heads/dev/').splitlines():
        stamp,name=line.split(' ',1);refs.append((int(stamp),name))
    refs.sort(reverse=True)
    keep={branch}
    if current.startswith('dev/'):keep.add(current)
    for _,name in refs:
        if len(keep)<3:keep.add(name)
    for _,name in refs:
        if name not in keep:git('branch','-D',name)
    print(revision)
    print('Retained source checkpoints: '+', '.join(sorted(keep)))

if __name__=='__main__':main()
