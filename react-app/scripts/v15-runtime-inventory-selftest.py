"""Fail-closed tests for the candidate public inventory, not closure proof."""
import contextlib, copy, importlib.util, io, json, os, pathlib, tempfile, unittest
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

if __name__=='__main__': unittest.main()
