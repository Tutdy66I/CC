"""Capture public prototype test evidence without touching historical archives."""
import hashlib, json, pathlib, shutil, subprocess, sys

def sha(b):return hashlib.sha256(b).hexdigest()
out=pathlib.Path('.test-build/public-evidence-restore-prototype');out.mkdir(parents=True,exist_ok=False)
files=['scripts/v15-public-evidence-archive.py','scripts/v15-public-evidence-archive-test.py','scripts/v15-public-evidence-archive-ci.py','package-lock.json','tsconfig.test.json','../.github/workflows/ci.yml']
status=1
try:
    p=subprocess.run([sys.executable,'-I','-B','scripts/v15-public-evidence-archive-test.py'],capture_output=True)
    (out/'test.stdout').write_bytes(p.stdout);(out/'test.stderr').write_bytes(p.stderr);status=p.returncode
    node=shutil.which('node');info={'scope':'synthetic-offline-only','python':{'version':sys.version,'executableSha256':sha(pathlib.Path(sys.executable).read_bytes())},'nodePath':node,'sourceSha256':{n:sha(pathlib.Path(n).read_bytes()) for n in files}}
    if node:
        info['nodeVersion']=json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.versions.node,v8:process.versions.v8})']))
        info['nodeSha256']=sha(pathlib.Path(node).read_bytes())
    (out/'identity.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf8')
except Exception as exc:
    (out/'capture-error.txt').write_text(repr(exc)+'\n',encoding='utf8');status=1
finally:
    (out/'exit.json').write_text(json.dumps({'exitCode':status})+'\n',encoding='utf8')
    items=sorted(x for x in out.iterdir() if x.is_file() and x.name!='manifest.json')
    (out/'manifest.json').write_text(json.dumps({'algorithm':'sha256','files':[{'name':p.name,'sha256':sha(p.read_bytes())} for p in items]},indent=2)+'\n',encoding='utf8')
print(json.dumps({'scope':'synthetic-offline-only','exitCode':status,'manifestSha256':sha((out/'manifest.json').read_bytes())}))
sys.exit(status)
