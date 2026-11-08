"""Negative tests for public evidence validation; no research data."""
import contextlib, copy, importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('evidence',pathlib.Path(__file__).with_name('v15-round2-evidence.py'))
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)

class EvidenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture=e.load_fixture()
        cls.data={name:json.loads(subprocess.run([sys.executable,'-I','-B',script],capture_output=True,check=True).stdout) for name,script in e.AUDITS.items()}
    def test_valid_public_evidence(self):
        for name,data in self.data.items(): e.validate(name,data,self.fixture)
    def test_missing_duplicate_and_changed_inputs(self):
        for name in ('envelopes','angles'):
            for mode in ('missing','duplicate','changed'):
                data=copy.deepcopy(self.data[name]); rows=data['results']
                if mode=='missing': rows.pop()
                elif mode=='duplicate': rows[-1]=copy.deepcopy(rows[0])
                else: rows[0]['case']['inputs'][0]='7fefffffffffffff'
                with self.assertRaises(ValueError): e.validate(name,data,self.fixture)
    def test_unexpected_status_and_mismatch(self):
        for name in ('envelopes','angles'):
            data=copy.deepcopy(self.data[name]);data['results'][0]['status']='uncertified'
            with self.assertRaises(ValueError): e.validate(name,data,self.fixture)
        data=copy.deepcopy(self.data['graph']);data['results'][0]['mismatch']=['fft[0]']
        with self.assertRaises(ValueError): e.validate('graph',data,self.fixture)
        data=copy.deepcopy(self.data['graph']);data['results'][0]['decision'][0]='boundary-uncertified'
        with self.assertRaises(ValueError): e.validate('graph',data,self.fixture)
        data=copy.deepcopy(self.data['graph']);data['results'][1]=copy.deepcopy(data['results'][0])
        with self.assertRaises(ValueError): e.validate('graph',data,self.fixture)
        data=copy.deepcopy(self.data['zf']);data['syntheticMismatchProbe']['source']='production'
        with self.assertRaises(ValueError): e.validate('zf',data,self.fixture)
    def test_bounds_and_evidence_inconsistencies(self):
        data=copy.deepcopy(self.data['angles']);data['results'][2]['lower']='7ff0000000000000'
        with self.assertRaises(ValueError): e.validate('angles',data,self.fixture)
        data=copy.deepcopy(self.data['graph']);data['results'][0]['trace'].pop()
        with self.assertRaises(ValueError): e.validate('graph',data,self.fixture)
        data=copy.deepcopy(self.data['zf']);data['checks'][0]['withinBaseline']=False
        with self.assertRaises(ValueError): e.validate('zf',data,self.fixture)
        data=copy.deepcopy(self.data['zf']);data['conditionalRounding'].pop()
        with self.assertRaises(ValueError): e.validate('zf',data,self.fixture)
        data=copy.deepcopy(self.data['zf']);data['fixture']['compiledSourceSha256']='0'*64
        with self.assertRaises(ValueError): e.validate('zf',data,self.fixture)
        data=copy.deepcopy(self.data['zf']);data['refinedDecision'][0]='certified'
        with self.assertRaises(ValueError): e.validate('zf',data,self.fixture)
    def test_reject_malformed_json(self):
        for text in ('{', '{"a":1,"a":2}', '{"a":NaN}'):
            with self.assertRaises((ValueError, UnicodeError)): e.parse_json(text.encode())
    def test_manifest_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=pathlib.Path(tmp);p=out/'public.json';p.write_bytes(b'original')
            (out/'manifest.json').write_text(json.dumps({'algorithm':'sha256','files':[{'name':'public.json','sha256':e.sha(p)}]}),encoding='utf-8')
            e.verify_manifest(out,['public.json']);p.write_bytes(b'tampered')
            with self.assertRaises(ValueError): e.verify_manifest(out,['public.json'])
    def test_subprocess_failure_preserves_evidence_and_fails(self):
        real=e.subprocess.run
        def run(args,**kwargs):
            if len(args)>3 and args[3]==e.AUDITS['envelopes']:
                return subprocess.CompletedProcess(args,1,b'partial public output',b'public error')
            return real(args,**kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ,{'ROUND2_PUBLIC_EVIDENCE_DIR':tmp}),mock.patch.object(e.subprocess,'run',side_effect=run):
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit): e.main()
            out=pathlib.Path(tmp)
            self.assertEqual((out/'envelopes.stdout.json').read_bytes(),b'partial public output')
            self.assertEqual((out/'envelopes.stderr.txt').read_bytes(),b'public error')
            self.assertEqual(json.loads((out/'envelopes.exit.json').read_text())['exitCode'],1)
            self.assertTrue(json.loads((out/'summary.json').read_text())['errors'])
    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=pathlib.Path(tmp)/'marker';marker.write_bytes(b'keep')
            with mock.patch.dict(os.environ,{'ROUND2_PUBLIC_EVIDENCE_DIR':tmp}):
                with self.assertRaises(ValueError): e.main()
            self.assertEqual(marker.read_bytes(),b'keep')

if __name__=='__main__': unittest.main()
