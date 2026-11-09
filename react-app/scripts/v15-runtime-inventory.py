"""Scoped public-audit inventory. This is not a complete runtime closure."""
import ast, hashlib, importlib.util, json, os, pathlib, re, shutil, subprocess, sys, tempfile, traceback

FIXTURE=pathlib.Path('tests/fixtures/v15-runtime-inventory.json')
FIXTURE_SHA256='ceb9727751447693e0ed9959c22b3dbca24e5dd440cf4a00cc171363e05a9d62'
EXPECTED_OUTPUTS={'audit.exit.json','audit.stderr.txt','audit.stdout.json','deterministic.json'} | {name+suffix for name in ('node-runtime','static-graph','typescript-rebuild') for suffix in ('.stdout','.stderr','.exit.json')}
def sha(data): return hashlib.sha256(data).hexdigest()
def need(condition,message):
    if not condition: raise ValueError(message)
def pairs(items):
    result={}
    for key,value in items:
        if key in result: raise ValueError('duplicate JSON key')
        result[key]=value
    return result
def parse(data): return json.loads(data.decode('utf8'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid number')))
def canonical_file(path):
    return pathlib.Path(path).read_bytes().replace(b'\r\n',b'\n')
def fixture():
    raw=canonical_file(FIXTURE);need(sha(raw)==FIXTURE_SHA256,'inventory fixture identity mismatch'); return parse(raw)
def python_imports(path):
    tree=ast.parse(pathlib.Path(path).read_text(encoding='utf8'),filename=path)
    return sorted({alias.name.split('.')[0] for item in ast.walk(tree) if isinstance(item,ast.Import) for alias in item.names} | {item.module.split('.')[0] for item in ast.walk(tree) if isinstance(item,ast.ImportFrom) and item.module})
def python_references(path):
    tree=ast.parse(pathlib.Path(path).read_text(encoding='utf8'),filename=path)
    return sorted({item.value for item in ast.walk(tree) if isinstance(item,ast.Constant) and isinstance(item.value,str) and re.fullmatch(r'(?:scripts/)?v15-[a-z0-9-]+(?:\.(?:py|mjs))?',item.value)})
def validate_versions(expected,actual):
    need(expected==actual,'runtime identity mismatch')
def validate_graph(expected,actual):
    need(expected==actual,'Node static import graph changed')
def validate_compiled(path,actual,rebuilt):
    need(actual==rebuilt,'compiled output mismatch: '+path)
def validate_files(expected):
    need(isinstance(expected,dict) and expected,'invalid source manifest')
    for path,digest in expected.items():
        p=pathlib.PurePosixPath(path)
        need(not p.is_absolute() and '..' not in p.parts and len(digest)==64,'invalid manifest path or digest')
        need(sha(canonical_file(path))==digest,'source digest mismatch: '+path)
def installed_packages(lock):
    installed=[];missing_optional=[]
    for path,entry in sorted(lock['packages'].items()):
        if not path.startswith('node_modules/'): continue
        p=pathlib.Path(path)/'package.json'
        if not p.is_file():
            need(bool(entry.get('optional')),'missing locked package: '+path)
            missing_optional.append(path);continue
        data=p.read_bytes();item=parse(data)
        if entry.get('version') is not None: need(item.get('version')==entry['version'],'installed version mismatch: '+path)
        installed.append({'path':path,'version':item.get('version'),'packageJsonSha256':sha(data)})
    return {'scope':'lock-listed package metadata; does not discover extraneous files or verify package tarball integrity','installed':installed,'missingOptional':missing_optional}
def verify_output_manifest(out):
    out=pathlib.Path(out); mp=out/'manifest.json';need(mp.is_file() and not mp.is_symlink(),'missing or unsafe manifest');manifest=parse(mp.read_bytes())
    need(isinstance(manifest,dict) and set(manifest)=={'algorithm','files'} and manifest['algorithm']=='sha256' and isinstance(manifest['files'],list),'invalid output manifest')
    names=[]
    for item in manifest['files']:
        need(isinstance(item,dict) and set(item)=={'name','sha256'},'invalid manifest entry')
        name=item['name']; digest=item['sha256']
        need(isinstance(name,str) and name in EXPECTED_OUTPUTS and '/' not in name and '\\' not in name and not pathlib.PureWindowsPath(name).is_absolute(),'invalid manifest path')
        need(isinstance(digest,str) and re.fullmatch('[0-9a-f]{64}',digest),'invalid manifest digest')
        need(name not in names,'duplicate manifest path');names.append(name)
        path=out/name;need(path.is_file() and not path.is_symlink(),'missing or unsafe evidence file')
        need(sha(path.read_bytes())==digest,'output digest mismatch: '+name)
    need(set(names)==EXPECTED_OUTPUTS,'output manifest file set mismatch')
    need({p.name for p in out.iterdir()}==EXPECTED_OUTPUTS|{'manifest.json'},'unexpected or missing output file')
def deterministic_packages(packages):
    entries=packages['installed'];missing=packages['missingOptional']
    need(len({x['path'] for x in entries})==len(entries) and len(set(missing))==len(missing),'duplicate installed package path')
    return {'installed':sorted(entries,key=lambda x:x['path']),'missingOptional':sorted(missing)}
def child(out,name,args):
    proc=subprocess.run(args,capture_output=True)
    (out/(name+'.stdout')).write_bytes(proc.stdout);(out/(name+'.stderr')).write_bytes(proc.stderr)
    (out/(name+'.exit.json')).write_text(json.dumps({'exitCode':proc.returncode})+'\n',encoding='utf8')
    need(proc.returncode==0,name+' process failed')
    return proc.stdout
def run(out):
    f=fixture();validate_files(f['sources'])
    node=shutil.which('node');need(node is not None,'node missing')
    node_info=parse(child(out,'node-runtime',[node,'-p','JSON.stringify({node:process.versions.node,v8:process.versions.v8,platform:process.platform,arch:process.arch})']))
    node_info['sha256']=sha(pathlib.Path(node).read_bytes())
    python_info={'version':sys.version,'sha256':sha(pathlib.Path(sys.executable).read_bytes())}
    evidence=pathlib.Path('.test-build/round2-public-evidence')
    spec=importlib.util.spec_from_file_location('round2',pathlib.Path('scripts/v15-round2-evidence.py'))
    e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
    names=[n+s for n in e.AUDITS for s in ('.stdout.json','.stderr.txt','.exit.json')]+['runtime.json','sources.json','summary.json','normalized.json']
    e.verify_manifest(evidence,names)
    summary=parse((evidence/'summary.json').read_bytes());need(summary['errors']==[] and set(summary['results'])==set(e.AUDITS),'round-two evidence failed')
    public_fixture=e.load_fixture()
    for name in e.AUDITS:
        need(parse((evidence/(name+'.exit.json')).read_bytes())['exitCode']==0,'round-two audit exit mismatch: '+name)
        checked=e.validate(name,parse((evidence/(name+'.stdout.json')).read_bytes()),public_fixture)
        need(checked==summary['results'][name],'round-two summary mismatch: '+name)
    recorded=parse((evidence/'runtime.json').read_bytes())
    validate_versions(node_info,{k:recorded['node'][k] for k in ('node','v8','platform','arch','sha256')})
    validate_versions(python_info,{k:recorded['python'][k] for k in ('version','sha256')})
    numeric=pathlib.Path('.test-build/numeric-public'); report=parse((numeric/'audit.json').read_bytes()); nr=parse((numeric/'runtime.json').read_bytes())
    spec2=importlib.util.spec_from_file_location('numeric',pathlib.Path('scripts/v15-numeric-public-ci.py')); mod=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(mod);mod.validate(report)
    need(nr['auditSha256']==sha((numeric/'audit.json').read_bytes()),'numeric evidence digest mismatch')
    validate_versions(node_info,{k:nr['node'][k] for k in ('node','v8','platform','arch','sha256')})
    validate_versions(python_info,{k:nr['python'][k] for k in ('version','sha256')})
    py={path:python_imports(path) for path in f['pythonImports']};need(py==f['pythonImports'],'Python static import graph changed')
    refs={path:python_references(path) for path in f['pythonReferences']};need(refs==f['pythonReferences'],'Python static file references changed')
    graph=parse(child(out,'static-graph',[node,'scripts/v15-runtime-graph.mjs']));validate_graph(f['nodeGraph'],graph)
    package=parse(pathlib.Path('node_modules/typescript/package.json').read_bytes());lock=parse(pathlib.Path('package-lock.json').read_bytes());need(package['version']==lock['packages']['node_modules/typescript']['version'],'TypeScript version mismatch');packages=installed_packages(lock)
    compiled=[p for p in graph['files'] if p.startswith('.test-build/src/lib/')]
    with tempfile.TemporaryDirectory(prefix='v15-runtime-build-') as tmp:
        child(out,'typescript-rebuild',[node,'node_modules/typescript/bin/tsc','-p','tsconfig.test.json','--outDir',tmp])
        emitted={}
        for path in compiled:
            relative=path.removeprefix('.test-build/'); actual=pathlib.Path(path).read_bytes(); rebuilt=(pathlib.Path(tmp)/relative).read_bytes()
            validate_compiled(path,actual,rebuilt)
            source='src/lib/'+pathlib.PurePosixPath(path).stem+'.ts';need(source in f['sources'],'compiled source missing: '+source)
            emitted[path]={'source':source,'sha256':sha(actual)}
    source_records=parse((evidence/'sources.json').read_bytes()); records={x['path']:x['sha256'] for x in source_records['files']};need(len(records)==len(source_records['files']),'duplicate evidence source path')
    for path in compiled: need(records.get(path)==sha(pathlib.Path(path).read_bytes()),'evidence compiled digest mismatch: '+path)
    for path in f['sources']:
        if path in records: need(records[path]==sha(pathlib.Path(path).read_bytes()),'evidence source digest mismatch: '+path)
    instrumentation={}
    for path in ('scripts/v15-runtime-inventory.py','scripts/v15-runtime-inventory-selftest.py'):
        actual=sha(pathlib.Path(path).read_bytes());need(records.get(path)==actual,'inventory source snapshot mismatch: '+path);instrumentation[path]=actual
    sources={path:{'rawSha256':sha(pathlib.Path(path).read_bytes()),'normalizedSha256':digest,'inRound2Snapshot':path in records} for path,digest in f['sources'].items()}
    return {'status':'unresolved','scope':'static pinned inputs and observed evidence only; not a runtime closure','node':node_info,'python':python_info,'executablePaths':{'node':str(pathlib.Path(node).resolve()),'python':str(pathlib.Path(sys.executable).resolve())},'typescript':{'version':package['version'],'compilerSha256':sha(pathlib.Path('node_modules/typescript/lib/typescript.js').read_bytes())},'installedPackages':packages,'instrumentation':instrumentation,'workflowSha256':sha(pathlib.Path('../.github/workflows/ci.yml').read_bytes()),'sources':sources,'pythonImports':py,'pythonReferences':refs,'nodeGraph':graph,'compiled':emitted,'round2ManifestSha256':sha((evidence/'manifest.json').read_bytes()),'numericAuditSha256':nr['auditSha256'],'unresolved':['Node/V8 native libraries and Math implementation','Python standard library and native math libraries','OS loader, kernel, CPU and floating-point environment','dynamic data URL generated at runtime; observed graph is static','npm installed package integrity and transitive native dependencies','GitHub Actions mutable tags, hosted runner image and network supply chain','unobserved imports, concurrent replacement and runtime completeness']}
def main():
    out=pathlib.Path(os.environ.get('V15_RUNTIME_INVENTORY_DIR','.test-build/runtime-inventory'));out.mkdir(parents=True,exist_ok=True)
    need(not any(out.iterdir()),'refusing to overwrite evidence')
    code=1
    try:
        data=run(out);(out/'audit.stdout.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf8');(out/'audit.stderr.txt').write_bytes(b'')
        stable={k:data[k] for k in ('status','scope','node','python','typescript','instrumentation','workflowSha256','pythonImports','pythonReferences','nodeGraph','compiled','unresolved')}
        stable['sources']={k:v['normalizedSha256'] for k,v in data['sources'].items()}
        stable['installedPackages']=deterministic_packages(data['installedPackages'])
        (out/'deterministic.json').write_text(json.dumps(stable,sort_keys=True,separators=(',',':'))+'\n',encoding='utf8');code=0
    except Exception:
        (out/'audit.stdout.json').write_bytes(b'');(out/'audit.stderr.txt').write_text(traceback.format_exc(),encoding='utf8')
    finally:
        (out/'audit.exit.json').write_text(json.dumps({'exitCode':code})+'\n',encoding='utf8')
        files=sorted(p for p in out.iterdir() if p.is_file() and p.name!='manifest.json')
        (out/'manifest.json').write_text(json.dumps({'algorithm':'sha256','files':[{'name':p.name,'sha256':sha(p.read_bytes())} for p in files]},indent=2)+'\n',encoding='utf8')
    if code==0:
        try: verify_output_manifest(out)
        except Exception:
            error=traceback.format_exc();(out/'manifest-verification-error.txt').write_text(error,encoding='utf8');print(error,file=sys.stderr);return 1
    if code: print((out/'audit.stderr.txt').read_text(encoding='utf8'),file=sys.stderr)
    else: print(json.dumps({'status':'unresolved','evidence':str(out),'manifestSha256':sha((out/'manifest.json').read_bytes())}))
    return code
if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--verify-manifest':
        try:verify_output_manifest(sys.argv[2]);print('output manifest verified')
        except Exception:traceback.print_exc();sys.exit(1)
    elif len(sys.argv)==1:sys.exit(main())
    else:sys.exit('usage: v15-runtime-inventory.py [--verify-manifest DIRECTORY]')
