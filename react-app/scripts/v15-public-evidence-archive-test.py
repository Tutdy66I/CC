"""Synthetic-only tests; source deletion is confined to this test's own temporary directory."""
import hashlib, importlib.util, io, json, pathlib, shutil, subprocess, sys, tempfile, unittest, warnings, zipfile

spec=importlib.util.spec_from_file_location('archive',pathlib.Path(__file__).with_name('v15-public-evidence-archive.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
def fixture():
    data={n:('public synthetic '+n+'\n').encode() for n in a.FILES}
    data['identity/inputs.json']=a.canonical({'purpose':'synthetic-public-test-only','input':'fixed-vector'})
    data['audit/deterministic.json']=a.canonical({'status':'boundary-uncertified'})
    data['audit/result.json']=a.canonical({'status':'boundary-uncertified','case':'public-fixed-vector'})
    data['audit/stdout.json']=data['audit/result.json']
    data['audit/exit.json']=a.canonical({'exitCode':0})
    data['identity/runtime.json']=a.canonical({'node':'synthetic','v8':'synthetic','python':'synthetic'})
    data['identity/source.json']=a.canonical({'sha256':'0'*64})
    return data
def changed_archive(raw,change):
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as src,zipfile.ZipFile(out,'w') as dst:
        items=[(x.filename,src.read(x)) for x in src.infolist()];items=change(items)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            for name,data in items:a.put(dst,name,data)
    return out.getvalue()
def reanchor(raw,anchor):
    d=a.parse(anchor);d['archiveSha256']=a.digest(raw);return a.canonical(d)
class ArchiveTest(unittest.TestCase):
    def setUp(self):self.files=fixture();self.raw,self.anchor=a.create(self.files)
    def reject(self,raw,anchor=None):
        with self.assertRaises(Exception):a.verify(raw,self.anchor if anchor is None else anchor)
    def test_restore_after_test_source_deletion(self):
        with tempfile.TemporaryDirectory(prefix='v15-synthetic-recovery-') as t:
            root=pathlib.Path(t).resolve();source=root/'source';backup=root/'backup';source.mkdir();backup.mkdir()
            for n,b in self.files.items():
                path=source/'input'/n;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b)
            reread={n:(source/'input'/n).read_bytes() for n in self.files};raw,anchor=a.create(reread)
            self.assertEqual((raw,anchor),(self.raw,self.anchor))
            (source/'bundle.zip').write_bytes(raw);(source/'anchor.json').write_bytes(anchor)
            shutil.copyfile(source/'bundle.zip',backup/'bundle.zip');shutil.copyfile(source/'anchor.json',backup/'anchor.json')
            self.assertEqual(source.resolve().parent,root);shutil.rmtree(source);self.assertFalse(source.exists())
            result=a.restore((backup/'bundle.zip').read_bytes(),(backup/'anchor.json').read_bytes(),root/'restore')
            self.assertEqual(result['deterministicSha256'],a.digest(self.files['audit/deterministic.json']))
            for n,b in self.files.items():self.assertEqual((root/'restore'/n).read_bytes(),b)
            self.assertTrue(a.verify_restored(root/'restore',(backup/'anchor.json').read_bytes()))
            (root/'restore'/'audit/result.json').write_bytes(b'changed')
            self.assertRaises(ValueError,a.verify_restored,root/'restore',(backup/'anchor.json').read_bytes())
    def test_reject_changed_archive_and_truncation(self):
        self.reject(self.raw[:-1]);self.reject(self.raw[:30]);self.reject(self.raw+b'x')
    def test_reject_missing_extra_and_duplicate(self):
        for edit in (lambda x:x[:-1],lambda x:x+[x[-1]],lambda x:x+[('../escape',b'x')]):
            raw=changed_archive(self.raw,edit);self.reject(raw,reanchor(raw,self.anchor))
    def test_reject_tampered_content_even_with_new_zip_hash(self):
        raw=changed_archive(self.raw,lambda xs:[(n,b'x' if n=='audit/result.json' else b) for n,b in xs]);self.reject(raw,reanchor(raw,self.anchor))
    def test_reject_manifest_tamper(self):
        raw=changed_archive(self.raw,lambda xs:[(n,b'{}' if n=='manifest.json' else b) for n,b in xs]);self.reject(raw,reanchor(raw,self.anchor))
    def test_reject_invalid_manifest_with_recomputed_test_anchor(self):
        with zipfile.ZipFile(io.BytesIO(self.raw)) as z:original=a.parse(z.read('manifest.json'))
        for kind in ('duplicate','escape','missing'):
            m=json.loads(json.dumps(original))
            if kind=='duplicate':m['files'][1]=m['files'][0].copy()
            elif kind=='escape':m['files'][0]['path']='../escape'
            else:m['files'].pop()
            mb=a.canonical(m);raw=changed_archive(self.raw,lambda xs:[(n,mb if n=='manifest.json' else b) for n,b in xs])
            self.reject(raw,a.canonical({'schema':a.SCHEMA,'manifestSha256':a.digest(mb),'archiveSha256':a.digest(raw)}))
    def test_reject_input_and_anchor_tamper(self):
        data=fixture();data.pop(a.FILES[0]);self.assertRaises(ValueError,a.create,data)
        data=fixture();data['identity/inputs.json']=b'{}';self.assertRaises(ValueError,a.create,data)
        self.reject(self.raw,b'{"schema":"invalid"}')
        data=fixture();data['audit/exit.json']=a.canonical({'exitCode':1});self.assertRaises(ValueError,a.create,data)
        data=fixture();data['audit/deterministic.json']=a.canonical({'status':'certified'});self.assertRaises(ValueError,a.create,data)
    def test_refuse_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='v15-existing-') as t:self.assertRaises(FileExistsError,a.restore,self.raw,self.anchor,t)
    def test_reject_symlink_zip_entry(self):
        out=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.raw)) as src,zipfile.ZipFile(out,'w') as dst:
            for info in src.infolist():
                b=src.read(info)
                if info.filename==a.FILES[0]: info.external_attr=0o120777<<16
                dst.writestr(info,b)
        raw=out.getvalue();self.reject(raw,reanchor(raw,self.anchor))
if __name__=='__main__':
    try: node=json.loads(subprocess.check_output(['node','-p','JSON.stringify({node:process.versions.node,v8:process.versions.v8})']))
    except Exception as e:node={'error':str(e)}
    raw,anchor=a.create(fixture());print(json.dumps({'scope':'synthetic-offline-only','python':sys.version,'node':node,'archiveSha256':a.digest(raw),'anchorSha256':a.digest(anchor),'manifestSha256':a.parse(anchor)['manifestSha256']},sort_keys=True),flush=True)
    unittest.main()
