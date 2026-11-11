"""Independent verifier tests with exclusively synthetic public bytes."""
import importlib.util, io, json, pathlib, subprocess, sys, tempfile, unittest, warnings, zipfile
def load(name):
    s=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
v=load('v15-synthetic-independent-verify');producer=load('v15-public-evidence-archive-test');a=producer.a
class IndependentTest(unittest.TestCase):
    def setUp(self):
        self.files=producer.fixture();self.raw,self.anchor=a.create(self.files)
        with zipfile.ZipFile(io.BytesIO(self.raw)) as z:self.manifest=z.read('manifest.json')
        self.expected=v.sha(self.anchor)
    def check(self,raw,manifest,anchor):return v.verify(raw,manifest,anchor,self.expected)
    def test_valid(self):self.assertFalse(self.check(self.raw,self.manifest,self.anchor)['originAuthenticated'])
    def test_fresh_directory_cli(self):
        with tempfile.TemporaryDirectory(prefix='v15-public-replay-') as d:
            p=pathlib.Path(d)
            for name,b in [('input.zip',self.raw),('manifest.json',self.manifest),('anchor.json',self.anchor)]: (p/name).write_bytes(b)
            verifier=pathlib.Path(__file__).with_name('v15-synthetic-independent-verify.py').resolve()
            before={x.name:x.read_bytes() for x in p.iterdir()}
            result=subprocess.run([sys.executable,'-I','-B',str(verifier),str(p/'input.zip'),str(p/'manifest.json'),str(p/'anchor.json'),'--anchor-sha256',self.expected],cwd=p,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(before,{x.name:x.read_bytes() for x in p.iterdir()})
            self.assertFalse(json.loads(result.stdout)['originAuthenticated'])
    def test_tamper_and_truncation(self):
        for raw in (self.raw+b'x',self.raw[:-12]):
            with self.assertRaises(Exception):self.check(raw,self.manifest,self.anchor)
        with self.assertRaises(ValueError):self.check(self.raw,self.manifest+b' ',self.anchor)
    def test_replace_archive_and_anchor(self):
        data=producer.fixture();data['audit/stderr.txt']=b'replacement';raw,anchor=a.create(data)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:manifest=z.read('manifest.json')
        with self.assertRaisesRegex(ValueError,'anchor digest mismatch'):self.check(raw,manifest,anchor)
        self.assertFalse(v.verify(raw,manifest,anchor,v.sha(anchor))['originAuthenticated'])
    def malformed(self,kind):
        out=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.raw)) as z,zipfile.ZipFile(out,'w') as w:
            pairs=[(i.filename,z.read(i)) for i in z.infolist()]
            if kind=='missing':pairs.pop()
            elif kind=='duplicate':pairs.append(pairs[-1])
            elif kind=='escape':pairs.append(('../escape',b'bad'))
            elif kind=='content':pairs=[(n,b'bad' if n=='audit/result.json' else b) for n,b in pairs]
            with warnings.catch_warnings():
                warnings.simplefilter('ignore',UserWarning)
                for n,b in pairs:a.put(w,n,b)
        raw=out.getvalue();anchor=a.canonical({'schema':a.SCHEMA,'archiveSha256':v.sha(raw),'manifestSha256':v.sha(self.manifest)})
        with self.assertRaises(Exception):v.verify(raw,self.manifest,anchor,v.sha(anchor))
    def test_missing(self):self.malformed('missing')
    def test_duplicate(self):self.malformed('duplicate')
    def test_escape(self):self.malformed('escape')
    def test_content_digest(self):self.malformed('content')
    def test_manifest_inconsistency(self):
        m=json.loads(self.manifest);m['files'][0]['sha256']='0'*64;manifest=a.canonical(m);anchor=a.canonical({'schema':a.SCHEMA,'archiveSha256':v.sha(self.raw),'manifestSha256':v.sha(manifest)})
        with self.assertRaises(Exception):v.verify(self.raw,manifest,anchor,v.sha(anchor))
if __name__=='__main__':unittest.main()
