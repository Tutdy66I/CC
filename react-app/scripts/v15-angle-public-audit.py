"""Public rational trigonometry enclosures; bounded computations, not a full libm proof."""
import functools, importlib.util, json, math, pathlib, struct, subprocess, time, tracemalloc
from fractions import Fraction

spec=importlib.util.spec_from_file_location('bounds',pathlib.Path(__file__).with_name('v15-numeric-public-audit.py'))
bounds=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounds)
class Uncertified(Exception): pass
def unhex(x): return struct.unpack('>d',bytes.fromhex(x))[0]
def hx(x): return struct.pack('>d',x).hex()
def neg(pair): return -pair[1],-pair[0]
def add(a,b): return a[0]+b[0],a[1]+b[1]
def mul_int(pair,k): return (pair[0]*k,pair[1]*k) if k>=0 else (pair[1]*k,pair[0]*k)
def atan_series(q,n=100):
    if abs(q)>Fraction(1,2): raise ValueError('atan series bound')
    s=sum(((-1)**k*q**(2*k+1)/(2*k+1) for k in range(n)),Fraction(0))
    t=s+(-1)**n*q**(2*n+1)/(2*n+1)
    return min(s,t),max(s,t)
@functools.lru_cache(maxsize=1)
def pi_bounds():
    # Machin identity with alternating-series rational remainders.
    return add(mul_int(atan_series(Fraction(1,5),100),16),mul_int(atan_series(Fraction(1,239),100),-4))
def atan_positive(q):
    if q<0: raise ValueError('negative atan input')
    if q>1: return add(mul_int(pi_bounds(),Fraction(1,2)),neg(atan_positive(1/q)))
    if q>Fraction(1,2): return add(atan_series(Fraction(1,2)),atan_series((q-Fraction(1,2))/(1+q/2)))
    return atan_series(q)
def atan2_bounds(y,x):
    if not math.isfinite(x) or not math.isfinite(y): raise ValueError('nonfinite')
    if x==0:
        if y==0: raise Uncertified('two signed zeros need separate rule')
        p=mul_int(pi_bounds(),Fraction(1,2));return p if y>0 else neg(p)
    if y==0:
        if x>0: return Fraction(0),Fraction(0)
        return neg(pi_bounds()) if math.copysign(1,y)<0 else pi_bounds()
    a=atan_positive(abs(Fraction.from_float(y)/Fraction.from_float(x)))
    if x>0: return a if y>0 else neg(a)
    return add(pi_bounds(),neg(a)) if y>0 else add(neg(pi_bounds()),a)
def trig_point(op,q,n=30):
    if abs(q)>1: raise ValueError('unproved reduced range')
    off=1 if op=='sin' else 0
    s=sum(((-1)**k*q**(2*k+off)/math.factorial(2*k+off) for k in range(n)),Fraction(0))
    t=s+(-1)**n*q**(2*n+off)/math.factorial(2*n+off)
    return min(s,t),max(s,t)
def reduced_trig(op,x):
    if not math.isfinite(x): raise ValueError('nonfinite')
    q=abs(Fraction.from_float(x));p=pi_bounds()
    kl=(q*2/p[1]+Fraction(1,2)).numerator//(q*2/p[1]+Fraction(1,2)).denominator
    ku=(q*2/p[0]+Fraction(1,2)).numerator//(q*2/p[0]+Fraction(1,2)).denominator
    if kl!=ku: raise Uncertified('argument reduction uncertified')
    low=q-kl*p[1]/2;high=q-kl*p[0]/2
    if low < -1 or high > 1: raise Uncertified('reduced range uncertified')
    # Outward dyadic enclosure limits rational denominator growth without
    # discarding any values in the exact reduction interval.
    den=1<<192
    low=Fraction((low*den).numerator//(low*den).denominator,den)
    scaled=high*den
    high=Fraction(-((-scaled.numerator)//scaled.denominator),den)
    def sin_interval(): return trig_point('sin',low)[0],trig_point('sin',high)[1]
    def cos_interval():
        if low<=0<=high: return min(trig_point('cos',low)[0],trig_point('cos',high)[0]),Fraction(1)
        if high<0: return trig_point('cos',low)[0],trig_point('cos',high)[1]
        return trig_point('cos',high)[0],trig_point('cos',low)[1]
    pattern=([('sin',1),('cos',1),('sin',-1),('cos',-1)] if op=='sin' else [('cos',1),('sin',-1),('cos',-1),('sin',1)])[kl%4]
    result=sin_interval() if pattern[0]=='sin' else cos_interval()
    if pattern[1]<0: result=neg(result)
    if op=='sin' and x<0: result=neg(result)
    return result
def main():
    started=time.perf_counter();tracemalloc.start()
    data=json.loads(subprocess.run(['node','scripts/v15-angle-public-node.mjs'],capture_output=True,text=True,check=True).stdout)
    if len(data['cases'])!=28: raise ValueError('unexpected public vector count')
    rows=[]
    for case in data['cases']:
        args=[unhex(x) for x in case['inputs']]
        try:
            lo,hi=atan2_bounds(*args) if case['op']=='atan2' else reduced_trig(case['op'],*args)
            status,lower,upper=bounds.certify(lo,hi,unhex(case['result']))
            if lower is None or upper is None:
                rows.append({'case':case,'status':'fail','reason':'nonfinite result'})
                continue
            if case['op']=='sin' and args[0]==0 and case['result']!=case['inputs'][0]: status='fail'
            if case['op']=='atan2' and args[0]==0 and args[1]>0 and case['result']!=case['inputs'][0]: status='fail'
            rows.append({'case':case,'lower':hx(lower),'upper':hx(upper),'status':status})
        except Uncertified as error:
            rows.append({'case':case,'status':'uncertified','reason':str(error)})
    peak=tracemalloc.get_traced_memory()[1]
    print(json.dumps({'runtime':data['runtime'],'results':rows,'metrics':{'wallSeconds':time.perf_counter()-started,'tracemallocPeakBytes':peak},'limits':['28 fixed public inputs only','argument reduction may be uncertified','not full libm or DSP proof']},indent=2))
    if any(row['status']=='fail' for row in rows): raise SystemExit(1)
if __name__=='__main__': main()
