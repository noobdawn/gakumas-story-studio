"""Read-only source/contract checks, safe without game data or Unity."""
import ast, hashlib, json, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    for name in ['CreatorPrototypePlayer.cs','CreatorPostEffects.shader','ActorNativeForwardFeature.cs']:
        p=ROOT/'unity/CreatorPlayer/Assets/Runtime'/name
        assert p.is_file(), 'Missing Unity source: '+str(p)
        if (ROOT/'.git').exists():
            subprocess.run(['git','ls-files','--error-unmatch',p.relative_to(ROOT).as_posix()],cwd=ROOT,check=True,capture_output=True)
    for p in (ROOT/'services').rglob('*.py'):ast.parse(p.read_text('utf-8-sig'),filename=str(p))
    for p in (ROOT/'apps/desktop').rglob('*.js'):
        if 'node_modules' in p.parts:continue
        subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
    for manifest in ['resources/common/manifest.json','resources/voicevox/models.json','resources/voicevox/components.json']:
        data=json.loads((ROOT/manifest).read_text('utf-8'))
        if manifest.startswith('resources/common'):
            for item in data['assets']:
                p=ROOT/'resources/common'/item['file']
                assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
    host=ast.parse((ROOT/'services/host/host.py').read_text('utf-8-sig'))
    allowed=next(set(ast.literal_eval(n.comparators[0])) for n in ast.walk(host) if isinstance(n,ast.Compare) and isinstance(n.left,ast.Name) and n.left.id=='name' and isinstance(n.ops[0],ast.NotIn) and isinstance(n.comparators[0],ast.Tuple) and 'index.html' in ast.literal_eval(n.comparators[0]))
    linked=set(re.findall(r'(?:src|href)="\./([^"#]+)"',(ROOT/'apps/desktop/ui/index.html').read_text('utf-8')))
    assert linked<=allowed, 'Host must serve linked UI files: '+str(linked-allowed)
    assert all((ROOT/'apps/desktop/ui'/name).is_file() for name in linked-{'classroom-props.js'})
    print('Syntax, UI route and resource manifest checks passed')
if __name__=='__main__':main()
