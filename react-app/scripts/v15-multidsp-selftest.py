"""Negative tests against the public replay, using no research input."""
import copy, importlib.util, json, pathlib, subprocess, unittest

path = pathlib.Path(__file__).with_name('v15-multidsp-public-audit.py')
spec = importlib.util.spec_from_file_location('multidsp', path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class PublicReplayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(subprocess.check_output(['node', 'scripts/v15-multidsp-public-node.mjs']))['cases']

    def test_public_fixtures(self):
        for case in self.cases:
            self.assertEqual(audit.audit(case)['decision'], ['certified', 'certified'])

    def test_missing_node(self):
        case = copy.deepcopy(self.cases[0]); case['events']['fir'].pop()
        with self.assertRaises(ValueError): audit.audit(case)

    def test_changed_fixed_input(self):
        case = copy.deepcopy(self.cases[0]); case['signal'][0] = '0000000000000000'
        with self.assertRaises(ValueError): audit.audit(case)

    def test_duplicate_node(self):
        case = copy.deepcopy(self.cases[0]); case['events']['fir'].append(case['events']['fir'][-1])
        with self.assertRaises(ValueError): audit.audit(case)

    def test_tampered_node(self):
        case = copy.deepcopy(self.cases[0]); case['events']['fft'][4]['value'] = '7fefffffffffffff'
        with self.assertRaises(ValueError): audit.audit(case)

    def test_outside_operand(self):
        case = copy.deepcopy(self.cases[0]); case['events']['fir'][0]['args'][0] = '7fefffffffffffff'
        with self.assertRaises(ValueError): audit.audit(case)

    def test_wrong_decision(self):
        case = copy.deepcopy(self.cases[0]); case['bits'][0] ^= 1
        with self.assertRaises(ValueError): audit.audit(case)

if __name__ == '__main__': unittest.main()
