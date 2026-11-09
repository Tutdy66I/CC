"""Fail-closed tests for the candidate public inventory, not closure proof."""
import contextlib, copy, importlib.util, io, json, os, pathlib, shutil, subprocess, sys, tempfile, unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('inventory',pathlib.Path(__file__).with_name('v15-runtime-inventory.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class InventoryTest(unittest.TestCase):
    def test_real_fixture_and_graph(self):
        f=m.fixture();m.validate_files(f['sources']);self.assertEqual(f['nodeGraph']['dynamic'][0]['from'],'scripts/v15-zf-trace-public.mjs')
    def test_missing_and_modified_dependency(self):
        f=m.fixture(); mapping=copy.deepcopy(f['sources']); mapping['scripts/not-present-public.py']='0'*64
        with self.assertRaises(FileNotFoundError):m.validate_files(mapping)
        mapping=copy.deepcopy(f['sources']);key=next(iter(mapping));mapping[key]='0'*64
        with self.assertRaisesRegex(ValueError,'source digest mismatch'):m.validate_files(mapping)
    def test_version_difference(self):
        with self.assertRaisesRegex(ValueError,'runtime identity mismatch'):m.validate_versions({'node':'24','v8':'a'},{'node':'24','v8':'b'})
    def test_installed_package_missing_and_version_mismatch(self):
        with self.assertRaisesRegex(ValueError,'missing locked package'):m.installed_packages({'packages':{'node_modules/not-a-real-dependency':{'version':'1'}}})
        with self.assertRaisesRegex(ValueError,'installed version mismatch'):m.installed_packages({'packages':{'node_modules/typescript':{'version':'0.0.0'}}})
    def test_graph_missing_or_extra_edge(self):
        f=m.fixture();g=copy.deepcopy(f['nodeGraph']);g['edges'].pop()
        with self.assertRaisesRegex(ValueError,'graph changed'):m.validate_graph(f['nodeGraph'],g)
        g=copy.deepcopy(f['nodeGraph']);g['edges'].append({'from':'x','to':'y'})
        with self.assertRaisesRegex(ValueError,'graph changed'):m.validate_graph(f['nodeGraph'],g)
    def test_tampered_compiled_output(self):
        with self.assertRaisesRegex(ValueError,'compiled output mismatch'):m.validate_compiled('public.js',b'original',b'tampered')
    def test_installed_metadata_normalization(self):
        a={'installed':[{'path':'b','version':'1','packageJsonSha256':'b'},{'path':'a','version':'2','packageJsonSha256':'a'}],'missingOptional':['z','x']}
        b={'installed':copy.deepcopy(list(reversed(a['installed']))),'missingOptional':list(reversed(a['missingOptional']))}
        self.assertEqual(m.deterministic_packages(a),m.deterministic_packages(b))
        b['installed'][0]['version']='changed';self.assertNotEqual(m.deterministic_packages(a),m.deterministic_packages(b))
    def test_manifest_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'fixture.json';p.write_bytes(b'{}')
            with mock.patch.object(m,'FIXTURE',p):
                with self.assertRaisesRegex(ValueError,'fixture identity mismatch'):m.fixture()
    def test_duplicate_json_and_escape(self):
        with self.assertRaisesRegex(ValueError,'duplicate'):m.parse(b'{"a":1,"a":2}')
        with self.assertRaisesRegex(ValueError,'invalid manifest path'):m.validate_files({'../outside':'0'*64})
    def test_failure_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.dict(os.environ,{'V15_RUNTIME_INVENTORY_DIR':d}),mock.patch.object(m,'run',side_effect=ValueError('missing dependency')):
                with contextlib.redirect_stderr(io.StringIO()):self.assertEqual(m.main(),1)
            out=pathlib.Path(d);self.assertIn('missing dependency',(out/'audit.stderr.txt').read_text());self.assertEqual(json.loads((out/'audit.exit.json').read_text())['exitCode'],1);self.assertTrue((out/'manifest.json').exists())

class OutputManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='v15-runtime-manifest-');cls.original=pathlib.Path(cls.tmp.name)/'original'
        with mock.patch.dict(os.environ,{'V15_RUNTIME_INVENTORY_DIR':str(cls.original)}),contextlib.redirect_stdout(io.StringIO()):
            if m.main()!=0:raise AssertionError('real inventory setup failed')
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def setUp(self):
        self.tmpcase=tempfile.TemporaryDirectory(prefix='v15-manifest-case-');self.out=pathlib.Path(self.tmpcase.name)/'evidence';shutil.copytree(self.original,self.out)
    def tearDown(self):self.tmpcase.cleanup()
    def read_manifest(self):return json.loads((self.out/'manifest.json').read_text(encoding='utf8'))
    def write_manifest(self,value):(self.out/'manifest.json').write_text(json.dumps(value),encoding='utf8')
    def test_real_output_passes(self):m.verify_output_manifest(self.out)
    def test_independent_cli(self):
        args=[sys.executable,'-I','-B','scripts/v15-runtime-inventory.py','--verify-manifest',str(self.out)]
        self.assertEqual(subprocess.run(args,capture_output=True).returncode,0)
        (self.out/'audit.stdout.json').write_bytes(b'tampered')
        self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0)
    def test_tampered_evidence(self):
        (self.out/'audit.stdout.json').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'digest mismatch'):m.verify_output_manifest(self.out)
    def test_tampered_digest(self):
        d=self.read_manifest();d['files'][0]['sha256']='0'*64;self.write_manifest(d)
        with self.assertRaisesRegex(ValueError,'digest mismatch'):m.verify_output_manifest(self.out)
    def test_duplicate_entry(self):
        d=self.read_manifest();d['files'].append(copy.deepcopy(d['files'][0]));self.write_manifest(d)
        with self.assertRaisesRegex(ValueError,'duplicate'):m.verify_output_manifest(self.out)
    def test_path_escape(self):
        for name in ('../outside','/tmp/outside','C:\\outside','sub/file','sub\\file'):
            d=self.read_manifest();d['files'][0]['name']=name;self.write_manifest(d)
            with self.assertRaisesRegex(ValueError,'invalid manifest path'):m.verify_output_manifest(self.out)
    def test_missing_entry(self):
        d=self.read_manifest();d['files'].pop();self.write_manifest(d)
        with self.assertRaisesRegex(ValueError,'file set mismatch'):m.verify_output_manifest(self.out)
    def test_missing_file(self):
        (self.out/'audit.stdout.json').unlink()
        with self.assertRaisesRegex(ValueError,'missing'):m.verify_output_manifest(self.out)
    def test_extra_file(self):
        (self.out/'unlisted.txt').write_text('extra',encoding='utf8')
        with self.assertRaisesRegex(ValueError,'unexpected'):m.verify_output_manifest(self.out)

if __name__=='__main__': unittest.main()
