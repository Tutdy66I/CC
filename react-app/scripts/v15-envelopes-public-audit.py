"""Public rational log/hypot enclosures; no formal inputs or protocol."""
import importlib.util, json, math, pathlib, struct, subprocess, time, tracemalloc
from fractions import Fraction

spec=importlib.util.spec_from_file_location('bounds',pathlib.Path(__file__).with_name('v15-numeric-public-audit.py'))
bounds=importlib.util.module_from_spec(spec); spec.loader.exec_module(bounds)
def unhex(x): return struct.unpack('>d',bytes.fromhex(x))[0]
def hx(x): return struct.pack('>d',x).hex()
def log_unit(q, terms=200):
    # For 1 <= q < 2: t=(q-1)/(q+1) in [0,1/3).
    # log(q)=2*sum(t^(2j+1)/(2j+1)); all omitted terms are nonnegative
    # and bounded by replacing their denominators with the first omitted one.
    if not 1<=q<=2: raise ValueError('bad reduction')
    t=(q-1)/(q+1)
    s=2*sum((t**(2*j+1)/ (2*j+1) for j in range(terms)),Fraction(0))
    rem=2*t**(2*terms+1)/((2*terms+1)*(1-t*t))
    return s,s+rem
def log_bounds(x):
    if not math.isfinite(x) or x<=0: raise ValueError('log domain')
    q=Fraction.from_float(x)
    k=q.numerator.bit_length()-q.denominator.bit_length()
    scale=Fraction(2)**k; m=q/scale
    if m<1: k-=1; m*=2
    lo,hi=log_unit(m); a,b=log_unit(Fraction(2))
    return (lo+k*a,hi+k*b) if k>=0 else (lo+k*b,hi+k*a)
def sqrt_rational(q):
    if q<0: raise ValueError('negative')
    p=1200; k=math.isqrt((q.numerator << (2*p))//q.denominator)
    lo=Fraction(k,1<<p)
    return lo,lo if lo*lo==q else Fraction(k+1,1<<p)
def hypot_bounds(x,y):
    if not math.isfinite(x) or not math.isfinite(y): raise ValueError('nonfinite')
    a,b=Fraction.from_float(x),Fraction.from_float(y)
    return sqrt_rational(a*a+b*b)
def main():
    started=time.perf_counter();tracemalloc.start()
    data=json.loads(subprocess.run(['node','scripts/v15-envelopes-public-node.mjs'],capture_output=True,text=True,check=True).stdout)
    if len(data['cases'])!=12: raise ValueError('unexpected public vector count')
    rows=[]
    for case in data['cases']:
        args=[unhex(x) for x in case['inputs']]
        if case['op']=='log' and len(args)==1: lo,hi=log_bounds(*args)
        elif case['op']=='hypot' and len(args)==2: lo,hi=hypot_bounds(*args)
        else: raise ValueError('unexpected operation')
        status,lower,upper=bounds.certify(lo,hi,unhex(case['result']))
        if lower is None or upper is None: raise ValueError('nonfinite result')
        rows.append({'case':case,'lower':hx(lower),'upper':hx(upper),'status':status})
    peak=tracemalloc.get_traced_memory()[1]
    print(json.dumps({'runtime':data['runtime'],'results':rows,'metrics':{'wallSeconds':time.perf_counter()-started,'tracemallocPeakBytes':peak},'limits':['12 fixed public inputs only','atan2 and unrestricted sin/cos remain uncertified','nonfinite and branch cuts not certified']},indent=2))
    if any(row['status']!='pass' for row in rows): raise SystemExit(1)
if __name__=='__main__': main()
