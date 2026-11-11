"""Save fixed public synthetic objects and independent test outputs for CI."""
import hashlib, importlib.util, io, json, pathlib, shutil, subprocess, sys, traceback, zipfile
def sha(b):return hashlib.sha256(b).hexdigest()
out=pathlib.Path('.test-build/synthetic-independent-replay');out.mkdir(parents=True,exist_ok=False);code=1
def run(name,args):
    p=subprocess.run(args,capture_output=True);(out/(name+'.stdout')).write_bytes(p.stdout);(out/(name+'.stderr')).write_bytes(p.stderr);(out/(name+'.exit.json')).write_text(json.dumps({'exitCode':p.returncode})+'\n',encoding='utf8')
    if p.returncode:raise ValueError(name+' failed')
try:
    p=pathlib.Path('scripts/v15-public-evidence-archive-test.py');s=importlib.util.spec_from_file_location('producer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
    raw,anchor=m.a.create(m.fixture())
    with zipfile.ZipFile(io.BytesIO(raw)) as z:manifest=z.read('manifest.json')
    for n,b in [('synthetic.zip',raw),('synthetic.manifest.json',manifest),('synthetic.anchor.json',anchor)]: (out/n).write_bytes(b)
    expected='70e0a3aa17a7cfa38a1ecbfa4490b237b4bd1a5ba31e0603a0f8aebcf5d60777'
    if sha(anchor)!=expected:raise ValueError('fixed synthetic anchor changed')
    run('verify',[sys.executable,'-I','-B','scripts/v15-synthetic-independent-verify.py',str(out/'synthetic.zip'),str(out/'synthetic.manifest.json'),str(out/'synthetic.anchor.json'),'--anchor-sha256',expected])
    run('tests',[sys.executable,'-I','-B','scripts/v15-synthetic-independent-test.py'])
    node=shutil.which('node');sources=['scripts/v15-public-evidence-archive.py','scripts/v15-public-evidence-archive-test.py','scripts/v15-synthetic-independent-verify.py','scripts/v15-synthetic-independent-test.py','scripts/v15-synthetic-independent-ci.py','../.github/workflows/ci.yml','package-lock.json']
    identity={'scope':'public-fixed-synthetic','python':sys.version,'pythonSha256':sha(pathlib.Path(sys.executable).read_bytes()),'node':json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.versions.node,v8:process.versions.v8})'])),'nodeSha256':sha(pathlib.Path(node).read_bytes()),'sourceSha256':{p:sha(pathlib.Path(p).read_bytes()) for p in sources}}
    (out/'identity.json').write_text(json.dumps(identity,indent=2)+'\n',encoding='utf8');code=0
except Exception:(out/'capture-error.txt').write_text(traceback.format_exc(),encoding='utf8')
finally:
    (out/'exit.json').write_text(json.dumps({'exitCode':code})+'\n',encoding='utf8')
    files=sorted(p for p in out.iterdir() if p.is_file() and p.name!='SHA256SUMS.json')
    (out/'SHA256SUMS.json').write_text(json.dumps({'algorithm':'sha256','files':[{'name':p.name,'sha256':sha(p.read_bytes())} for p in files]},indent=2)+'\n',encoding='utf8')
print(json.dumps({'exitCode':code,'artifactManifestSha256':sha((out/'SHA256SUMS.json').read_bytes())}))
sys.exit(code)
