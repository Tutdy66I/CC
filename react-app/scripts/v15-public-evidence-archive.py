"""Offline synthetic public-evidence prototype; not a long-term backup service."""
import hashlib, io, json, pathlib, re, stat, zipfile

FILES=('audit/deterministic.json','audit/result.json','audit/stderr.txt','audit/stdout.json','audit/exit.json','identity/inputs.json','identity/runtime.json','identity/source.json')
SCHEMA='signallab-public-synthetic-archive-1'
MAX_FILE=1048576
def digest(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
def need(ok,why):
    if not ok:raise ValueError(why)
def unique(pairs):
    out={}
    for k,v in pairs:
        need(k not in out,'duplicate JSON key');out[k]=v
    return out
def parse(b):return json.loads(b.decode('utf8'),object_pairs_hook=unique,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
def validate_name(n):
    need(isinstance(n,str) and n in FILES and not pathlib.PureWindowsPath(n).is_absolute() and not pathlib.PurePosixPath(n).is_absolute() and '\\' not in n and all(x not in ('','.','..') for x in n.split('/')),'invalid archive path')
def put(z,name,data):
    info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.create_system=3;info.external_attr=(stat.S_IFREG|0o600)<<16;info.compress_type=zipfile.ZIP_STORED;z.writestr(info,data)
def validate_payload(files):
    need(parse(files['identity/inputs.json']).get('purpose')=='synthetic-public-test-only','synthetic marker missing')
    need(parse(files['audit/exit.json'])=={'exitCode':0},'unsuccessful audit exit')
    observed=parse(files['audit/stdout.json']);result=parse(files['audit/result.json']);stable=parse(files['audit/deterministic.json'])
    need(observed==result and isinstance(result,dict) and result.get('status') in ('certified','boundary-uncertified') and stable=={'status':result['status']},'inconsistent synthetic result')
    runtime=parse(files['identity/runtime.json']);source=parse(files['identity/source.json'])
    need(isinstance(runtime,dict) and all(isinstance(runtime.get(x),str) and runtime[x] for x in ('node','v8','python')),'runtime identity missing')
    need(isinstance(source,dict) and isinstance(source.get('sha256'),str) and re.fullmatch('[0-9a-f]{64}',source['sha256']),'source identity missing')
def create(files):
    need(isinstance(files,dict) and set(files)==set(FILES),'missing or extra input')
    entries=[]
    for n in FILES:
        validate_name(n);b=files[n];need(isinstance(b,bytes) and len(b)<=MAX_FILE,'invalid input bytes');entries.append({'path':n,'size':len(b),'sha256':digest(b)})
    validate_payload(files)
    manifest=canonical({'schema':SCHEMA,'files':entries});stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        put(z,'manifest.json',manifest)
        for n in FILES:put(z,n,files[n])
    raw=stream.getvalue();return raw,canonical({'schema':SCHEMA,'manifestSha256':digest(manifest),'archiveSha256':digest(raw)})
def verify(raw,anchor):
    a=parse(anchor);need(set(a)=={'schema','manifestSha256','archiveSha256'} and a['schema']==SCHEMA,'invalid anchor')
    for k in ('manifestSha256','archiveSha256'):need(isinstance(a[k],str) and re.fullmatch('[0-9a-f]{64}',a[k]),'invalid digest')
    need(digest(raw)==a['archiveSha256'],'archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        info=z.infolist();names=[x.filename for x in info]
        need(len(names)==len(set(names)) and set(names)==set(FILES)|{'manifest.json'},'duplicate, missing or extra archive entry')
        for x in info:
            need(not x.is_dir() and not stat.S_ISLNK(x.external_attr>>16) and x.file_size<=MAX_FILE and x.compress_type==zipfile.ZIP_STORED,'unsafe entry')
            if x.filename!='manifest.json':validate_name(x.filename)
        mb=z.read('manifest.json');need(digest(mb)==a['manifestSha256'],'manifest digest mismatch');m=parse(mb)
        need(canonical(m)==mb and set(m)=={'schema','files'} and m['schema']==SCHEMA and isinstance(m['files'],list),'invalid manifest')
        need(len(m['files'])==len(FILES),'manifest count')
        need([x.get('path') if isinstance(x,dict) else None for x in m['files']]==list(FILES),'manifest order')
        payload={};seen=set()
        for item in m['files']:
            need(isinstance(item,dict) and set(item)=={'path','size','sha256'},'invalid manifest item');n=item['path'];validate_name(n);need(n not in seen,'duplicate manifest path');seen.add(n)
            b=z.read(n);need(type(item['size']) is int and item['size']==len(b) and isinstance(item['sha256'],str) and digest(b)==item['sha256'],'file digest mismatch');payload[n]=b
        need(seen==set(FILES),'invalid payload');validate_payload(payload)
        return payload
def restore(raw,anchor,destination):
    payload=verify(raw,anchor);dest=pathlib.Path(destination).absolute()
    for parent in (dest.parent,*dest.parent.parents):
        need(not parent.is_symlink() and not (hasattr(parent,'is_junction') and parent.is_junction()),'unsafe destination ancestor')
    dest.mkdir(exist_ok=False)
    for n,b in payload.items():
        target=dest.joinpath(*n.split('/'));target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as f:f.write(b)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:mb=z.read('manifest.json')
    with (dest/'manifest.json').open('xb') as f:f.write(mb)
    verify_restored(dest,anchor)
    return {'status':'synthetic-offline-restored','files':len(payload),'deterministicSha256':digest(payload['audit/deterministic.json'])}
def verify_restored(destination,anchor):
    dest=pathlib.Path(destination);a=parse(anchor);mp=dest/'manifest.json';need(not mp.is_symlink() and not dest.is_symlink(),'unsafe restored path');mb=mp.read_bytes();need(digest(mb)==a['manifestSha256'],'restored manifest digest mismatch');m=parse(mb)
    need(canonical(m)==mb and m['schema']==SCHEMA and [x['path'] for x in m['files']]==list(FILES),'restored manifest invalid')
    actual=set();payload={}
    for p in dest.rglob('*'):
        need(not p.is_symlink() and not (hasattr(p,'is_junction') and p.is_junction()),'restored link')
        if p.is_dir():need(p.relative_to(dest).as_posix() in ('audit','identity'),'unexpected restored directory')
        if p.is_file():actual.add(p.relative_to(dest).as_posix())
    need(actual==set(FILES)|{'manifest.json'},'restored file set mismatch')
    for item in m['files']:
        n=item['path'];validate_name(n);b=dest.joinpath(*n.split('/')).read_bytes();need(len(b)==item['size'] and digest(b)==item['sha256'],'restored digest mismatch');payload[n]=b
    validate_payload(payload);return True
