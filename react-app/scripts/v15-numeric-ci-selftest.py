"""Fail-closed coverage checks for the public numeric CI adapter."""
import copy
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('ci', pathlib.Path(__file__).with_name('v15-numeric-public-ci.py'))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)

def valid_report():
    rows = []
    for kind, fields in ci.EXPECTED:
        case = dict(zip(ci.KEYS[kind], fields))
        row = dict(kind=kind, case=case, status='pass')
        if kind == 'basic': case['result'] = '0'*16; row['expected'] = '0'*16
        elif kind == 'transcendental': case['result'] = '0'*16; row.update(lower='0'*16, upper='0'*16)
        elif kind == 'qpsk-sign': case['decision'] = 0; row['expected'] = 0
        else: case.update(gt=False, lt=False); row['expected'] = dict(gt=False,lt=False)
        rows.append(row)
    return {'node': {'node': '24.0', 'v8': '1', 'platform': 'test', 'arch': 'x64'}, 'results': rows}

class CoverageTest(unittest.TestCase):
    def test_expected_37(self):
        self.assertEqual(len(ci.EXPECTED), 37)
        ci.validate(valid_report())
    def test_missing_or_duplicate(self):
        report = valid_report(); report['results'].pop()
        with self.assertRaises(ValueError): ci.validate(report)
        report = valid_report(); report['results'][-1] = copy.deepcopy(report['results'][0])
        with self.assertRaises(ValueError): ci.validate(report)
    def test_status_missing_failed_uncertified(self):
        for status in ('fail', 'uncertified', None):
            report = valid_report(); report['results'][0]['status'] = status
            with self.assertRaises(ValueError): ci.validate(report)
        report = valid_report(); del report['results'][0]['status']
        with self.assertRaises(ValueError): ci.validate(report)
    def test_altered_case_and_runtime(self):
        report = valid_report(); report['results'][0]['case']['a'] = '0000000000000000'
        with self.assertRaises(ValueError): ci.validate(report)
        report = valid_report(); del report['results'][0]['case']['result']
        with self.assertRaises(ValueError): ci.validate(report)
        report = valid_report(); del report['node']['v8']
        with self.assertRaises(ValueError): ci.validate(report)
    def test_measurements_not_compared(self):
        report = valid_report(); report['pythonMetrics'] = {'elapsedSeconds': 12345}
        report['nodeMetrics'] = {'rssBytes': 1}
        ci.validate(report)
    def test_audit_exception_fails_and_preserves_output(self):
        original = os.getcwd()
        with tempfile.TemporaryDirectory() as temp:
            try:
                os.chdir(temp)
                failed = subprocess.CompletedProcess(['audit'], 1, b'partial evidence', b'public error')
                with mock.patch.object(ci.subprocess, 'run', return_value=failed):
                    with self.assertRaises(SystemExit): ci.main()
                output = pathlib.Path('.test-build/numeric-public')
                self.assertEqual((output/'audit.json').read_bytes(), b'partial evidence')
                self.assertEqual((output/'audit.stderr.txt').read_bytes(), b'public error')
            finally:
                os.chdir(original)

if __name__ == '__main__': unittest.main()
