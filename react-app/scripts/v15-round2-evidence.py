"""Preserve and validate fixed public round-two evidence; not a research protocol."""
import hashlib, importlib.util, json, math, os, pathlib, re, shutil, struct, subprocess, sys

AUDITS={'envelopes':'scripts/v15-envelopes-public-audit.py','angles':'scripts/v15-angle-public-audit.py','graph':'scripts/v15-interval-public-audit.py','zf':'scripts/v15-zf-public-audit.py'}
FIXTURE=pathlib.Path('tests/fixtures/v15-round2-public-inputs.json')
HEX=re.compile(r'^[0-9a-f]{16}$')
def require(ok,message):
    if not ok: raise ValueError(message)
def pairs(items):
    d={}
    for k,v in items:
        if k in d: raise ValueError('duplicate JSON key')
        d[k]=v
    return d
def parse_json(raw):
    return json.loads(raw.decode('utf-8'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
def load_fixture(): return parse_json(FIXTURE.read_bytes())
def load_module(name):
    spec=importlib.util.spec_from_file_location(name,pathlib.Path('scripts')/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def number(bits):
    require(isinstance(bits,str) and HEX.fullmatch(bits),'invalid binary64')
    value=struct.unpack('>d',bytes.fromhex(bits))[0]
    require(math.isfinite(value),'nonfinite binary64')
    return value
def in_bounds(value,lower,upper):
    v,lo,hi=number(value),number(lower),number(upper)
    return lo<=v<=hi
def validate(name,data,fixture):
    require(isinstance(data,dict),'invalid evidence root')
    if name in ('envelopes','angles'):
        implementation=load_module('v15-envelopes-public-audit' if name=='envelopes' else 'v15-angle-public-audit')
        rows=data['results'];expected=fixture[name]
        require(len(rows)==len(expected),'missing/extra cases')
        identities=[{'op':r['case']['op'],'inputs':r['case']['inputs']} for r in rows]
        require(identities==expected and len({json.dumps(x,sort_keys=True) for x in identities})==len(expected),'input mismatch or duplicate')
        for row in rows:
            case=row['case']; special=name=='angles' and case['op'] in ('sin','cos') and case['inputs']==['7fefffffffffffff']
            require(row['status']==('uncertified' if special else 'pass'),'unexpected status')
            number(case['result'])
            args=[number(x) for x in case['inputs']]
            if name=='angles' and case['op']=='sin' and args[0]==0:
                require(case['result']==case['inputs'][0],'sin zero sign mismatch')
            if name=='angles' and case['op']=='atan2' and args[0]==0 and args[1]>0:
                require(case['result']==case['inputs'][0],'atan2 zero sign mismatch')
            if special:
                require(row.get('reason')=='argument reduction uncertified','unexpected uncertainty reason')
                try: implementation.reduced_trig(case['op'],*args)
                except implementation.Uncertified: pass
                else: raise ValueError('uncertified status inconsistent')
            else:
                if name=='envelopes': lo,hi=(implementation.log_bounds(*args) if case['op']=='log' else implementation.hypot_bounds(*args))
                else: lo,hi=(implementation.atan2_bounds(*args) if case['op']=='atan2' else implementation.reduced_trig(case['op'],*args))
                status,lower,upper=implementation.bounds.certify(lo,hi,number(case['result']))
                require(status=='pass' and row['lower']==implementation.hx(lower) and row['upper']==implementation.hx(upper),'recomputed bounds mismatch')
                require(in_bounds(case['result'],row['lower'],row['upper']),'result outside bounds')
        return {'cases':len(rows),'pass':sum(r['status']=='pass' for r in rows),'uncertified':sum(r['status']=='uncertified' for r in rows)}
    if name=='graph':
        implementation=load_module('v15-interval-public-audit')
        rows=data['results'];require(len(rows)==4,'graph count')
        for row,case in zip(rows,fixture['graph']):
            obs=row['observation'];require({'id':row['id'],'signal':obs['signal'],'h':obs['h']}==case and obs['id']==row['id'],'graph input mismatch')
            require(row['nodeCount']==47 and len(row['trace'])==47 and [x['node'] for x in row['trace']]==fixture['graphTraceNames'],'graph trace mismatch')
            for item in row['trace']: require(number(item['lower'])<=number(item['upper']),'invalid graph bounds')
            require(row['mismatch']==[],'production graph mismatch')
            decision=['boundary-uncertified','certified'] if row['id']=='zf-boundary' else ['certified','certified']
            require(row['decision']==decision,'unexpected graph decision')
            for v in obs['signal']+obs['h']+obs['fir']+obs['fft']+obs['decision']: number(v)
            require(len(obs['fir'])==4 and len(obs['fft'])==4 and len(obs['decision'])==2 and len(obs['bits'])==2,'graph output shape')
            require(obs['bits']==[0 if number(x)>=0 else 1 for x in obs['decision']],'graph bits mismatch')
            require(implementation.audit(obs,data['nodeConstants'])==row,'graph recomputation mismatch')
            for axis,key in enumerate(('zf.re','zf.im')):
                t=next(x for x in row['trace'] if x['node']==key)
                require(in_bounds(obs['decision'][axis],t['lower'],t['upper']),'graph coordinate outside bounds')
        return {'cases':4,'nodesPerCase':47,'boundaryUncertified':1}
    if name=='zf':
        check=data['checks']; rounding=data['conditionalRounding']; fixture_data=data['fixture'];row=fixture_data['fixture']
        require({'id':row['id'],'signal':row['signal'],'h':row['h']}==fixture['graph'][3],'zf input mismatch')
        require(len(check)==16 and [x['name'] for x in check]==fixture['zfTraceNames'],'zf trace count or order')
        require(len(fixture_data['trace'])==16 and [x['name'] for x in fixture_data['trace']]==fixture['zfTraceNames'],'zf source trace')
        require(len(rounding)==15 and [x['node'] for x in rounding]==fixture['zfRoundingNames'],'zf rounding count or order')
        for item,trace in zip(check,fixture_data['trace']):
            require(item['observed']==trace['bits'] and item['withinBaseline'] is True and item['withinRefined'] is True,'zf inconsistent trace')
            number(item['observed'])
            if item['name']=='scale': require(item['observed']==item['exactExpected'],'scale mismatch')
            else:
                for k in ('baseline','refined'): require(item[k]['node']==item['name'] and in_bounds(item['observed'],item[k]['lower'],item[k]['upper']),'zf outside bounds')
                require(number(item['baseline']['lower'])<=number(item['refined']['lower'])<=number(item['refined']['upper'])<=number(item['baseline']['upper']),'refinement invalid')
        values={x['name']:x['observed'] for x in check}
        for item in rounding: require(item['matches'] is True and item['expected']==item['observed']==values[item['node']],'rounding mismatch')
        require(fixture_data['productionDecision']==row['decision']==[values['zf.re'],values['zf.im']],'production result mismatch')
        require(fixture_data['compiledSourceSha256']==sha(pathlib.Path('.test-build/src/lib/ofdmEqualizer.js')),'compiled source digest mismatch')
        implementation=load_module('v15-zf-public-audit');module=implementation.graph
        baseline=module.audit(row,fixture_data['nodeConstants']);old=module.Graph
        try:
            module.Graph=implementation.NearestGraph
            refined=module.audit(row,fixture_data['nodeConstants'])
        finally: module.Graph=old
        for item in check:
            if item['name']!='scale':
                require(item['baseline']==next(x for x in baseline['trace'] if x['node']==item['name']) and item['refined']==next(x for x in refined['trace'] if x['node']==item['name']),'recomputed zf bounds mismatch')
        require(row['bits']==[0 if number(x)>=0 else 1 for x in row['decision']],'zf decision bits mismatch')
        require(data['firstStrictCrossing']=='zf.re.numerator' and data['baselineDecision']==['boundary-uncertified','certified'] and data['refinedDecision']==['boundary-uncertified','certified'],'zf classification mismatch')
        crossings=[item['name'] for item in check if item['name']!='scale' and number(item['baseline']['lower'])<0<number(item['baseline']['upper'])]
        require(crossings and crossings[0]==data['firstStrictCrossing'],'first crossing inconsistent')
        for key,field in (('baseline','baselineDecision'),('refined','refinedDecision')):
            for axis,node_name in enumerate(('zf.re','zf.im')):
                interval=next(x for x in check if x['name']==node_name)[key]
                lo,hi=number(interval['lower']),number(interval['upper'])
                bit=0 if lo>=0 else 1 if hi<0 else None
                classification='boundary-uncertified' if bit is None else 'certified' if bit==row['bits'][axis] else 'mismatch'
                require(data[field][axis]==classification,'boundary classification inconsistent')
        probe=data['syntheticMismatchProbe']
        require(probe['source']=='deliberately-altered-public-test' and probe['field']=='fft[0]' and probe['original']==row['fft'][0] and probe['altered']=='4059000000000000' and probe['status']=='mismatch' and probe['detectedNodes']==['fft[0]'],'synthetic mismatch invalid')
        return {'traceNodes':16,'roundingChecks':15,'boundaryUncertified':1,'syntheticMismatch':1}
    raise ValueError('unknown audit')

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def source_snapshot():
    roots=[pathlib.Path('src/lib'),pathlib.Path('.test-build/src/lib'),pathlib.Path('scripts')]
    paths=[p for root in roots for p in root.rglob('*') if p.is_file() and (p.suffix in ('.ts','.js') if root!=pathlib.Path('scripts') else p.name.startswith('v15-') and p.suffix in ('.py','.mjs'))]
    paths += [FIXTURE,pathlib.Path('package-lock.json'),pathlib.Path('tsconfig.test.json'),pathlib.Path('../.github/workflows/ci.yml')]
    return [{'path':p.as_posix(),'sha256':sha(p)} for p in sorted(set(paths),key=lambda p:p.as_posix())]
def deterministic(value):
    if isinstance(value,dict): return {k:deterministic(v) for k,v in value.items() if k not in ('runtime','metrics')}
    if isinstance(value,list): return [deterministic(v) for v in value]
    return value
def verify_manifest(out,expected_names):
    manifest=parse_json((out/'manifest.json').read_bytes())
    require(manifest.get('algorithm')=='sha256' and isinstance(manifest.get('files'),list),'invalid manifest')
    entries=manifest['files']; names=[x['name'] for x in entries]
    require(len(names)==len(set(names)) and set(names)==set(expected_names),'manifest names mismatch')
    for entry in entries:
        name=entry['name']
        require(isinstance(name,str) and pathlib.PurePath(name).name==name and name not in ('.','..','manifest.json'),'invalid manifest path')
        require(entry['sha256']==sha(out/name),'evidence hash mismatch')
def main():
    out=pathlib.Path(os.environ.get('ROUND2_PUBLIC_EVIDENCE_DIR','.test-build/round2-public-evidence'))
    out.mkdir(parents=True,exist_ok=True)
    require(not any(out.iterdir()),'evidence output must be empty; refusing to overwrite')
    errors=[];results={}
    try:
        fixture=load_fixture()
        node=shutil.which('node');require(node is not None,'node missing')
        version=subprocess.run([node,'-p','JSON.stringify({node:process.versions.node,v8:process.versions.v8,platform:process.platform,arch:process.arch})'],capture_output=True,check=True)
        runtime={'python':{'version':sys.version,'executable':sys.executable,'sha256':sha(sys.executable)},'node':{**parse_json(version.stdout),'executable':node,'sha256':sha(node)}}
        (out/'runtime.json').write_text(json.dumps(runtime,indent=2)+'\n',encoding='utf-8')
        (out/'sources.json').write_text(json.dumps({'scope':'candidate source snapshot; not a complete dependency or runtime closure','files':source_snapshot()},indent=2)+'\n',encoding='utf-8')
    except Exception as exc:
        (out/'setup-error.txt').write_text(type(exc).__name__+': '+str(exc)+'\n',encoding='utf-8')
        raise
    normalized={}
    for name,script in AUDITS.items():
        try:
            p=subprocess.run([sys.executable,'-I','-B',script],capture_output=True)
            (out/(name+'.stdout.json')).write_bytes(p.stdout);(out/(name+'.stderr.txt')).write_bytes(p.stderr)
            (out/(name+'.exit.json')).write_text(json.dumps({'exitCode':p.returncode})+'\n',encoding='utf-8')
            require(p.returncode==0,'audit subprocess failed')
            data=parse_json(p.stdout);results[name]=validate(name,data,fixture)
            normalized[name]=deterministic(data)
        except Exception as exc:
            errors.append({'audit':name,'error':type(exc).__name__+': '+str(exc)})
            if not (out/(name+'.exit.json')).exists():
                (out/(name+'.exit.json')).write_text(json.dumps({'exitCode':None,'spawnError':str(exc)})+'\n',encoding='utf-8')
                (out/(name+'.stderr.txt')).write_text(type(exc).__name__+': '+str(exc)+'\n',encoding='utf-8')
                (out/(name+'.stdout.json')).write_bytes(b'')
    if len(normalized)==4:
        try:
            z=parse_json((out/'zf.stdout.json').read_bytes())['fixture'];g=parse_json((out/'graph.stdout.json').read_bytes())
            require(z['fixture']==g['results'][3]['observation'] and z['nodeConstants']==g['nodeConstants'],'cross-audit fixture mismatch')
            for name in ('envelopes','angles','graph'):
                require(parse_json((out/(name+'.stdout.json')).read_bytes())['runtime']=={k:runtime['node'][k] for k in ('node','v8')},'runtime mismatch')
            require(z['runtime']=={k:runtime['node'][k] for k in ('node','v8')},'zf runtime mismatch')
        except Exception as exc: errors.append({'audit':'cross-audit','error':type(exc).__name__+': '+str(exc)})
    (out/'summary.json').write_text(json.dumps({'results':results,'errors':errors},indent=2)+'\n',encoding='utf-8')
    (out/'normalized.json').write_text(json.dumps(normalized,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
    files=sorted(p for p in out.iterdir() if p.is_file() and p.name!='manifest.json')
    (out/'manifest.json').write_text(json.dumps({'algorithm':'sha256','files':[{'name':p.name,'sha256':sha(p)} for p in files]},indent=2)+'\n',encoding='utf-8')
    if not errors:
        expected=[name+suffix for name in AUDITS for suffix in ('.stdout.json','.stderr.txt','.exit.json')]+['runtime.json','sources.json','summary.json','normalized.json']
        verify_manifest(out,expected)
    print(json.dumps({'results':results,'errors':errors,'manifestSha256':sha(out/'manifest.json')},indent=2))
    if errors or len(results)!=len(AUDITS): raise SystemExit(1)
if __name__=='__main__': main()
