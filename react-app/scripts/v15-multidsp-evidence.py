"""Preserve public probe outputs even when an audit fails; not a study archive."""
import hashlib, json, pathlib, shutil, subprocess, sys, traceback

root = pathlib.Path.cwd()
out = root / '.test-build' / 'multidsp-public-evidence'
out.mkdir(parents=True, exist_ok=False)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def run(name, args):
    try:
        proc = subprocess.run(args, capture_output=True)
        stdout, stderr, code = proc.stdout, proc.stderr, proc.returncode
    except Exception:
        stdout, stderr, code = b'', traceback.format_exc().encode(), -1
    (out / (name + '.stdout')).write_bytes(stdout)
    (out / (name + '.stderr')).write_bytes(stderr)
    (out / (name + '.exitcode')).write_text(str(code) + '\n', encoding='ascii')
    return code

status = 1
try:
    node = pathlib.Path(shutil.which('node')).resolve()
    py = pathlib.Path(sys.executable).resolve()
    runtime = {'python':sys.version, 'pythonExecutable':str(py), 'pythonSha256':digest(py),
               'nodeExecutable':str(node), 'nodeSha256':digest(node),
               'nodeVersions':json.loads(subprocess.check_output([str(node),'-p','JSON.stringify(process.versions)']))}
    (out/'runtime.json').write_text(json.dumps(runtime,indent=2),encoding='utf8')
    paths = ['scripts/v15-multidsp-public-node.mjs','scripts/v15-multidsp-public-audit.py',
             'scripts/v15-multidsp-selftest.py','scripts/v15-multidsp-evidence.py',
             'scripts/v15-interval-public-audit.py','scripts/v15-angle-public-audit.py',
             'scripts/v15-numeric-public-audit.py','src/lib/multipathChannel.ts',
             'src/lib/fft.ts','src/lib/ofdmEqualizer.ts','src/lib/ofdmModulation.ts',
             '.test-build/src/lib/multipathChannel.js','.test-build/src/lib/fft.js',
             '.test-build/src/lib/ofdmEqualizer.js','.test-build/src/lib/ofdmModulation.js',
             'tsconfig.test.json','package-lock.json']
    (out/'sources.json').write_text(json.dumps({p:digest(root/p) for p in paths},indent=2),encoding='utf8')
    if run('node',[str(node),'scripts/v15-multidsp-public-node.mjs']): raise ValueError('node probe failed')
    if run('audit',[str(py),'-I','-B','scripts/v15-multidsp-public-audit.py',str(out/'node.stdout')]): raise ValueError('audit failed')
    if run('selftest',[str(py),'-I','-B','scripts/v15-multidsp-selftest.py']): raise ValueError('negative tests failed')
    data=json.loads((out/'audit.stdout').read_bytes())
    results=data['results']
    expected=[('fir2-fft8',{'fir':128,'fft':162,'ls':15,'zf':15}),('fir3-fft16',{'fir':384,'fft':418,'ls':15,'zf':15}),('fir4-rounded-fft8',{'fir':256,'fft':162,'ls':15,'zf':15})]
    if len(results)!=len(expected): raise ValueError('case count')
    for item,(name,counts) in zip(results,expected):
        if item['id']!=name or item['nodes']!=counts or item['decision']!=['certified','certified'] or any(len(item['trace'][stage])!=count for stage,count in counts.items()):
            raise ValueError('unexpected result or missing trace')
    (out/'summary.json').write_text(json.dumps({'cases':[{'id':x['id'],'nodes':x['nodes'],'decision':x['decision']} for x in results], 'metrics':data['metrics']},indent=2),encoding='utf8')
    status=0
except Exception:
    (out/'runner.stderr').write_text(traceback.format_exc(),encoding='utf8')
finally:
    (out/'runner.exitcode').write_text(str(status)+'\n',encoding='ascii')
    (out/'SHA256SUMS.json').write_text(json.dumps({p.name:digest(p) for p in sorted(out.iterdir()) if p.is_file()},indent=2),encoding='utf8')
if status: sys.exit(status)
