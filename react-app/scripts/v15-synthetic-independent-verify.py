"""Independent read-only verifier for PR #32's fixed public synthetic format."""
import argparse, hashlib, io, json, pathlib, re, stat, sys, zipfile

NAMES=('audit/deterministic.json','audit/result.json','audit/stderr.txt','audit/stdout.json','audit/exit.json','identity/inputs.json','identity/runtime.json','identity/source.json')
SCHEMA='signallab-public-synthetic-archive-1'
def sha(x):return hashlib.sha256(x).hexdigest()
def require(ok,msg):
    if not ok:raise ValueError(msg)
def pairs(items):
    out={}
    for k,v in items:require(k not in out,'duplicate JSON key');out[k]=v
    return out
def parse(b):return json.loads(b.decode('utf8'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
def canonical(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
def verify(raw,manifest,anchor,expected_anchor_sha):
    require(isinstance(expected_anchor_sha,str) and re.fullmatch('[0-9a-f]{64}',expected_anchor_sha),'invalid expected anchor digest')
    require(sha(anchor)==expected_anchor_sha,'anchor digest mismatch')
    a=parse(anchor);require(isinstance(a,dict) and set(a)=={'schema','manifestSha256','archiveSha256'} and a['schema']==SCHEMA,'anchor schema')
    require(a['archiveSha256']==sha(raw) and a['manifestSha256']==sha(manifest),'anchor reference mismatch')
    m=parse(manifest);require(isinstance(m,dict) and set(m)=={'schema','files'} and m['schema']==SCHEMA and canonical(m)==manifest,'manifest format')
    entries=m['files'];require(isinstance(entries,list) and len(entries)==len(NAMES),'manifest count')
    require(all(isinstance(x,dict) and set(x)=={'path','sha256','size'} for x in entries),'manifest entry')
    require([x['path'] for x in entries]==list(NAMES),'manifest path/order mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos=z.infolist();names=[x.filename for x in infos];require(len(names)==len(set(names)) and set(names)==set(NAMES)|{'manifest.json'},'ZIP entry set')
        for x in infos:require(not x.is_dir() and not stat.S_ISLNK(x.external_attr>>16) and x.file_size<=1048576 and x.compress_type==zipfile.ZIP_STORED,'unsafe ZIP entry')
        require(z.read('manifest.json')==manifest,'external manifest differs from ZIP')
        data={}
        for item in entries:
            name=item['path'];require(name in NAMES and '\\' not in name and '..' not in name.split('/'),'unsafe path')
            b=z.read(name);require(type(item['size']) is int and item['size']==len(b) and item['sha256']==sha(b),'payload digest mismatch: '+name);data[name]=b
    inp=parse(data['identity/inputs.json']);require(inp=={'purpose':'synthetic-public-test-only','input':'fixed-vector'},'not the public fixed input')
    result=parse(data['audit/result.json']);require(result==parse(data['audit/stdout.json']) and result=={'status':'boundary-uncertified','case':'public-fixed-vector'},'synthetic result mismatch')
    require(parse(data['audit/deterministic.json'])=={'status':result['status']} and parse(data['audit/exit.json'])=={'exitCode':0},'synthetic status mismatch')
    require(parse(data['identity/runtime.json'])=={'node':'synthetic','v8':'synthetic','python':'synthetic'} and parse(data['identity/source.json'])=={'sha256':'0'*64},'synthetic identity mismatch')
    return {'scope':'synthetic-only','archiveSha256':sha(raw),'manifestSha256':sha(manifest),'anchorSha256':sha(anchor),'payloadCount':len(data),'status':result['status'],'originAuthenticated':False}
def main():
    p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('manifest');p.add_argument('anchor');p.add_argument('--anchor-sha256',required=True);a=p.parse_args()
    try:
        data=[]
        for value in (a.archive,a.manifest,a.anchor):
            path=pathlib.Path(value);require(path.is_file() and not path.is_symlink(),'unsafe input');data.append(path.read_bytes())
        print(json.dumps(verify(*data,a.anchor_sha256),sort_keys=True))
    except Exception as e:print(type(e).__name__+': '+str(e),file=sys.stderr);return 1
    return 0
if __name__=='__main__':sys.exit(main())
