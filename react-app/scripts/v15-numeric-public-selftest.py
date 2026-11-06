"""Checks the public audit's interval and fail-closed machinery, not DSP correctness."""
import importlib.util, math, pathlib, unittest
from fractions import Fraction

spec=importlib.util.spec_from_file_location('audit',pathlib.Path(__file__).with_name('v15-numeric-public-audit.py'))
audit=importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)

class AuditTest(unittest.TestCase):
    def test_sqrt_bounds(self):
        for x in (0.0, 5e-324, 0.5, 1.0, 2.0, 1e300):
            lo,hi=audit.sqrt_bounds(x); q=Fraction.from_float(x)
            self.assertLessEqual(lo*lo,q); self.assertGreaterEqual(hi*hi,q)
        self.assertEqual(audit.sqrt_bounds(4.0),(Fraction(2),Fraction(2)))
    def test_trig_restriction_and_zero(self):
        self.assertEqual(audit.trig_bounds('sin',0.0),(Fraction(0),Fraction(0)))
        self.assertEqual(audit.trig_bounds('cos',0.0),(Fraction(1),Fraction(1)))
        with self.assertRaises(ValueError): audit.trig_bounds('sin',2.0)
    def test_fail_and_uncertified(self):
        one=Fraction(1)
        self.assertEqual(audit.certify(one,one,1.0)[0],'pass')
        self.assertEqual(audit.certify(one,one,math.nextafter(1.0,math.inf))[0],'fail')
        self.assertEqual(audit.certify(one,one,math.inf)[0],'fail')
        self.assertEqual(audit.certify(Fraction(0),Fraction(1),0.5)[0],'uncertified')

if __name__=='__main__': unittest.main()
