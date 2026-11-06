"""Fixed public two-point graph; no research inputs or RNG."""
import importlib.util, json, math, pathlib, struct, subprocess, time, tracemalloc
from fractions import Fraction

spec=importlib.util.spec_from_file_location('bounds',pathlib.Path(__file__).with_name('v15-numeric-public-audit.py'))
bounds=importlib.util.module_from_spec(spec); spec.loader.exec_module(bounds)
def unhex(x): return struct.unpack('>d',bytes.fromhex(x))[0]
def hx(x): return struct.pack('>d',x).hex()

class Graph:
    def __init__(self): self.trace=[]
    def exact(self,x):
        q=Fraction.from_float(x); return (q,q)
    def rounded(self,name,lo,hi):
        if lo>hi: raise ValueError('invalid interval')
        a,b=bounds.floor_float(lo),bounds.ceil_float(hi)
        if not math.isfinite(a) or not math.isfinite(b): raise ValueError('nonfinite interval')
        self.trace.append({'node':name,'lower':hx(a),'upper':hx(b)})
        return (Fraction.from_float(a),Fraction.from_float(b))
    def add(self,n,a,b): return self.rounded(n,a[0]+b[0],a[1]+b[1])
    def sub(self,n,a,b): return self.rounded(n,a[0]-b[1],a[1]-b[0])
    def mul(self,n,a,b):
        p=[x*y for x in a for y in b]; return self.rounded(n,min(p),max(p))
    def div(self,n,a,b):
        if b[0]<=0<=b[1]: raise ValueError('denominator interval crosses zero')
        p=[x/y for x in a for y in b]; return self.rounded(n,min(p),max(p))

def check(interval, value):
    v=Fraction.from_float(value)
    return interval[0]<=v<=interval[1]

def classify_sign(interval, bit):
    certified=0 if interval[0]>=0 else 1 if interval[1]<0 else None
    return 'boundary-uncertified' if certified is None else 'certified' if certified==bit else 'mismatch'

def classify_threshold(interval, threshold, strict):
    """Compare >= threshold, or > threshold when strict; uncertain intervals stop."""
    t=Fraction.from_float(threshold)
    if (interval[0]>t if strict else interval[0]>=t): return 'above'
    if (interval[1]<=t if strict else interval[1]<t): return 'below'
    return 'boundary-uncertified'

def classify_peak(first,second):
    if first[0]==first[1]==second[0]==second[1]: return 'earliest-exact-tie'
    if first[0]>second[1]: return 'first'
    if second[0]>first[1]: return 'second'
    return 'boundary-uncertified'

def audit(row, node):
    if len(row['signal']) != 4 or len(row['h']) != 2 or len(row['fir']) != 4 or len(row['fft']) != 4 or len(row['decision']) != 2 or len(row['bits']) != 2:
        raise ValueError('invalid public fixture lengths')
    g=Graph(); s=[g.exact(unhex(x)) for x in row['signal']]; h=[g.exact(unhex(x)) for x in row['h']]
    one,zero=g.exact(1.0),g.exact(0.0)
    # Same per-operation FIR order for this fixed unit tap (add to +0 output).
    fir=[]
    for i in (0,2):
        re=g.sub('fir.re.product',g.mul('fir.ii',one,s[i]),g.mul('fir.qq',zero,s[i+1]))
        im=g.add('fir.im.product',g.mul('fir.qi',zero,s[i]),g.mul('fir.iq',one,s[i+1]))
        fir += [g.add('fir.re.accumulate',zero,re),g.add('fir.im.accumulate',zero,im)]
    # n=2 has j=0 and exact cos(-0)=1, sin(-0)=-0. Signed-zero bits
    # are deliberately not certified by this value-interval representation.
    re=g.sub('butterfly.re',g.mul('butterfly.c-re',one,fir[2]),g.mul('butterfly.s-im',zero,fir[3]))
    im=g.add('butterfly.im',g.mul('butterfly.s-re',zero,fir[2]),g.mul('butterfly.c-im',one,fir[3]))
    out=[g.add('fft.out0.re',fir[0],re),g.add('fft.out0.im',fir[1],im),g.sub('fft.out1.re',fir[0],re),g.sub('fft.out1.im',fir[1],im)]
    lo,hi=bounds.sqrt_bounds(2.0); sqrt=g.rounded('sqrt2.enclosure',lo,hi)
    scale=g.div('fft.scale',one,sqrt)
    fft=[g.mul('fft.scaled',v,scale) for v in out]
    # Scale is known exactly for these public h inputs: max(abs(hi),abs(hq)).
    scale_value=max(abs(unhex(x)) for x in row['h']); scale_h=g.exact(scale_value)
    a=g.div('zf.a',h[0],scale_h); b=g.div('zf.b',h[1],scale_h)
    d=g.add('zf.d',g.mul('zf.a2',a,a),g.mul('zf.b2',b,b))
    u=g.div('zf.u',fft[0],scale_h); v=g.div('zf.v',fft[1],scale_h)
    zre=g.div('zf.re',g.add('zf.re.numerator',g.mul('zf.ua',u,a),g.mul('zf.vb',v,b)),d)
    zim=g.div('zf.im',g.sub('zf.im.numerator',g.mul('zf.va',v,a),g.mul('zf.ub',u,b)),d)
    mismatch=[]
    if not check(sqrt,unhex(node['sqrt2'])): mismatch.append('sqrt2')
    if not check(scale,unhex(node['scale'])): mismatch.append('scale')
    for label,ints,vals in [('fir',fir,row['fir']),('fft',fft,row['fft']),('decision',[zre,zim],row['decision'])]:
        for i,(interval,value) in enumerate(zip(ints,vals)):
            if not check(interval,unhex(value)): mismatch.append(f'{label}[{i}]')
    for i,(value,bit) in enumerate(zip(row['decision'],row['bits'])):
        if bit != (0 if unhex(value)>=0 else 1): mismatch.append(f'bit[{i}]')
    decision=[]
    for interval, actual in zip([zre,zim],row['bits']):
        decision.append(classify_sign(interval,actual))
    return {'id':row['id'],'observation':row,'nodeCount':len(g.trace),'mismatch':mismatch,'decision':decision,'trace':g.trace}

def main():
    start=time.perf_counter(); tracemalloc.start()
    node=json.loads(subprocess.run(['node','scripts/v15-interval-public-node.mjs'],capture_output=True,text=True,check=True).stdout)
    if [r['id'] for r in node['cases']] != ['ordinary','cancel','near','zf-boundary']:
        raise ValueError('missing or unexpected public cases')
    results=[audit(row,node) for row in node['cases']]
    peak=tracemalloc.get_traced_memory()[1]
    print(json.dumps({'runtime':node['runtime'],'nodeConstants':{'sqrt2':node['sqrt2'],'scale':node['scale']},'results':results,'metrics':{'wallSeconds':time.perf_counter()-start,'tracemallocPeakBytes':peak},'limits':['only fixed 2-point input and unit FIR tap','signed zero not certified','not full production graph or formal study']},indent=2))
    if any(r['mismatch'] or 'mismatch' in r['decision'] for r in results): raise SystemExit(1)
if __name__=='__main__': main()
