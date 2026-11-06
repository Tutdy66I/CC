"""Public interval machinery checks; no confirmation samples."""
import copy, importlib.util, json, math, pathlib, subprocess, unittest
from fractions import Fraction

def load(name):
    spec=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
env=load('v15-envelopes-public-audit')
graph=load('v15-interval-public-audit')
angle=load('v15-angle-public-audit')

class Checks(unittest.TestCase):
    def test_log_series_nests(self):
        for q in (Fraction(1),Fraction(5,4),Fraction(2)):
            lo,hi=env.log_unit(q,20); inner_lo,inner_hi=env.log_unit(q,40)
            self.assertLessEqual(lo,inner_lo);self.assertGreaterEqual(hi,inner_hi)
        self.assertEqual(env.log_bounds(1.0),(Fraction(0),Fraction(0)))
        with self.assertRaises(ValueError): env.log_bounds(0)
    def test_hypot_square_bounds(self):
        for x,y in ((0.,0.),(3.,4.),(5e-324,5e-324),(1e300,1e300)):
            lo,hi=env.hypot_bounds(x,y);a=Fraction.from_float(x);b=Fraction.from_float(y);q=a*a+b*b
            self.assertLessEqual(lo*lo,q);self.assertGreaterEqual(hi*hi,q)
        self.assertEqual(env.hypot_bounds(3.,4.),(Fraction(5),Fraction(5)))
        with self.assertRaises(ValueError): env.hypot_bounds(math.inf,1.)
    def test_graph_classification_and_tamper(self):
        data=json.loads(subprocess.run(['node','scripts/v15-interval-public-node.mjs'],capture_output=True,text=True,check=True).stdout)
        rows=[graph.audit(row,data) for row in data['cases']]
        self.assertTrue(all(not row['mismatch'] for row in rows))
        self.assertEqual(rows[-1]['decision'][0],'boundary-uncertified')
        changed=copy.deepcopy(data['cases'][0]);changed['fft'][0]='4059000000000000'
        self.assertIn('fft[0]',graph.audit(changed,data)['mismatch'])
        changed=copy.deepcopy(data['cases'][0]);changed['bits'][0]^=1
        self.assertIn('bit[0]',graph.audit(changed,data)['mismatch'])
    def test_zero_denominator_stops(self):
        g=graph.Graph()
        with self.assertRaises(ValueError): g.div('invalid',g.exact(1.0),(Fraction(-1),Fraction(1)))
    def test_boundary_and_tie_classes(self):
        z=Fraction(0); one=Fraction(1); half=Fraction(1,2)
        self.assertEqual(graph.classify_sign((z,z),0),'certified')
        self.assertEqual(graph.classify_sign((z,z),1),'mismatch')
        self.assertEqual(graph.classify_sign((-one,one),0),'boundary-uncertified')
        self.assertEqual(graph.classify_threshold((half,half),0.5,True),'below')
        self.assertEqual(graph.classify_threshold((half,half),0.5,False),'above')
        self.assertEqual(graph.classify_threshold((z,one),0.5,True),'boundary-uncertified')
        self.assertEqual(graph.classify_peak((one,one),(one,one)),'earliest-exact-tie')
        self.assertEqual(graph.classify_peak((z,one),(half,one)),'boundary-uncertified')
        self.assertEqual(graph.classify_peak((one,one),(z,half)),'first')
    def test_angle_rational_identities(self):
        p=angle.pi_bounds(); self.assertLess(p[0],Fraction(22,7));self.assertGreater(p[1],Fraction(3))
        known_lower=Fraction('3.14159265358979323846264338327950288')
        self.assertGreater(p[0],known_lower)
        self.assertLess(p[1],known_lower+Fraction(1,10**35))
        a=angle.atan2_bounds(1.,1.); self.assertLessEqual(a[0],p[1]/4);self.assertGreaterEqual(a[1],p[0]/4)
        self.assertEqual(angle.reduced_trig('sin',0.),(Fraction(0),Fraction(0)))
        self.assertEqual(angle.reduced_trig('cos',0.),(Fraction(1),Fraction(1)))
        with self.assertRaises(angle.Uncertified): angle.atan2_bounds(0.,0.)
        with self.assertRaises(angle.Uncertified): angle.reduced_trig('sin',float.fromhex('0x1.fffffffffffffp+1023'))

if __name__=='__main__': unittest.main()
