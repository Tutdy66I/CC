"""Exact rational public fixed-input audit; no research seeds, records or protocol."""
import json, math, os, struct, subprocess, time, tracemalloc
from fractions import Fraction

def from_hex(h): return struct.unpack('>d', bytes.fromhex(h))[0]
def bits(x): return struct.pack('>d', x).hex()
def floor_float(q):
    x = float(q)
    return math.nextafter(x, -math.inf) if Fraction.from_float(x) > q else x
def ceil_float(q):
    x = float(q)
    return math.nextafter(x, math.inf) if Fraction.from_float(x) < q else x

def trig_bounds(op, x):
    if x == 0: return (Fraction(0), Fraction(0)) if op == 'sin' else (Fraction(1), Fraction(1))
    # On |x| <= 1 the alternating terms strictly decrease. Consecutive
    # rational partial sums enclose the exact value; no libm is used here.
    q = Fraction.from_float(x)
    if abs(q) > 1: raise ValueError('outside proved interval')
    offset = 1 if op == 'sin' else 0
    s = sum(((-1)**k * q**(2*k+offset) / math.factorial(2*k+offset) for k in range(60)), Fraction(0))
    t = s + (-1)**60 * q**(120+offset) / math.factorial(120+offset)
    return min(s,t), max(s,t)

def sqrt_bounds(x):
    q = Fraction.from_float(x)
    if q < 0: raise ValueError('negative input')
    p = 1200
    k = math.isqrt((q.numerator << (2*p)) // q.denominator)
    lo = Fraction(k, 1 << p)
    return (lo, lo if lo*lo == q else Fraction(k+1, 1 << p))

def certify(lo, hi, result):
    if not math.isfinite(result) or lo > hi:
        return 'fail', None, None
    lower, upper = floor_float(lo), ceil_float(hi)
    adjacent = lower == upper or math.nextafter(lower, math.inf) == upper
    return ('uncertified' if not adjacent else 'pass' if lower <= result <= upper else 'fail'), lower, upper

def main():
    t = time.perf_counter(); tracemalloc.start()
    proc = subprocess.run(['node','scripts/v15-numeric-public-node.mjs'],check=True, text=True, capture_output=True)
    data = json.loads(proc.stdout); results=[]
    for c in data['basics']:
        a,b = Fraction.from_float(from_hex(c['a'])),Fraction.from_float(from_hex(c['b']))
        value = {'add': lambda:a+b,'sub': lambda:a-b,'mul':lambda:a*b,'div':lambda:a/b}[c['op']]()
        expected = bits(float(value))
        results.append({'kind':'basic','case':c,'expected':expected,'status':'pass' if c['result']==expected else 'fail'})
    for c in data['transcendentals']:
        x=from_hex(c['input']); lo,hi = sqrt_bounds(x) if c['op']=='sqrt' else trig_bounds(c['op'],x)
        result = from_hex(c['result'])
        status,lower,upper = certify(lo,hi,result)
        if lower is None or upper is None: raise ValueError('nonfinite result')
        # Numeric interval comparison alone equates +0 and -0; check signs separately.
        if x == 0 and c['op'] in ('sin', 'sqrt') and c['result'] != c['input']:
            status = 'fail'
        results.append({'kind':'transcendental','case':c,'lower':bits(lower),'upper':bits(upper),'status':status})
    for c in data['boundaries']:
        expected = 0 if from_hex(c['input']) >= 0 else 1
        results.append({'kind':'qpsk-sign','case':c,'expected':expected,'status':'pass' if c['decision']==expected else 'fail'})
    for c in data['threshold']:
        x,t0 = from_hex(c['input']),from_hex(c['threshold'])
        expected = {'gt':x>t0,'lt':x<t0}
        results.append({'kind':'threshold','case':c,'expected':expected,'status':'pass' if all(c[k]==v for k,v in expected.items()) else 'fail'})
    current,peak=tracemalloc.get_traced_memory()
    print(json.dumps({'results':results,'node':data['runtime'],'nodeMetrics':data['metrics'],'pythonMetrics':{'elapsedSeconds':time.perf_counter()-t,'tracemallocPeakBytes':peak,'pid':os.getpid()},'limits':['trigonometric proof only for abs(x)<=1','FFT/FIR/LS/ZF/CFO propagation and log/atan2/hypot not certified','not end-to-end receiver validation']},indent=2))
    if any(r['status'] != 'pass' for r in results): raise SystemExit(1)
if __name__ == '__main__': main()
