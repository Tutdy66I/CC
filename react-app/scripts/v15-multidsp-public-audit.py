"""Public 8/16-point DSP proof probe, not formal research or a full receiver."""
import functools, importlib.util, json, math, pathlib, struct, subprocess, sys, time, tracemalloc
from fractions import Fraction

def load(name):
    spec=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
graph=load('v15-interval-public-audit'); angles=load('v15-angle-public-audit'); bounds=load('v15-numeric-public-audit')
def unhex(h): return struct.unpack('>d',bytes.fromhex(h))[0]
def hx(x): return struct.pack('>d',x).hex()
def point(v):
    q=Fraction.from_float(v);return q,q
def within(r,x): return r[0]<=Fraction.from_float(x)<=r[1]
def ab(r):
    return (Fraction(0) if r[0]<=0<=r[1] else min(abs(r[0]),abs(r[1])),max(abs(r[0]),abs(r[1])))
@functools.lru_cache(maxsize=None)
def trig(op,x): return angles.reduced_trig(op,x)

class Replay:
    instances=[]
    def __init__(self,events):
        self.events=events;self.index=0;self.trace=[];self.current=None;self.g=graph.Graph();self.instances.append(self)
    def take(self,op,args, angle=None):
        self.current={'index':self.index,'op':op,'inputBounds':[[hx(float(lo)),hx(float(hi))] for lo,hi in args], 'observed':self.events[self.index] if self.index<len(self.events) else None}
        if self.index>=len(self.events):raise ValueError('missing node')
        event=self.events[self.index];self.index+=1
        if event['name']!=op or len(event['args'])!=len(args):raise ValueError('node order mismatch')
        if any(not within(r,unhex(v)) for r,v in zip(args,event['args'])):raise ValueError('operand outside bound')
        if op in ('sin','cos'):
            if hx(angle)!=event['args'][0]:raise ValueError('twiddle angle mismatch')
            lo,hi=trig(op,angle)
            status,_,_=bounds.certify(lo,hi,unhex(event['value']))
            if status!='pass':raise ValueError('trigonometric envelope '+status)
            out=self.g.rounded(op,lo,hi)
            if angle==0 and op=='sin' and event['value']!=event['args'][0]:raise ValueError('sin zero-sign mismatch')
        elif op=='sqrt':
            lo,hi=bounds.sqrt_bounds(unhex(event['args'][0]))
            status,_,_=bounds.certify(lo,hi,unhex(event['value']))
            if status!='pass':raise ValueError('sqrt envelope '+status)
            out=self.g.rounded(op,lo,hi)
        else: out=getattr(self.g,op)(op,*args)
        self.current['outputBounds']=[hx(float(out[0])),hx(float(out[1]))]
        if not within(out,unhex(event['value'])):raise ValueError('node output outside bound')
        self.trace.append({'index':self.index-1,'op':op,'operands':event['args'],'actual':event['value'],'lower':hx(float(out[0])),'upper':hx(float(out[1]))})
        return out
    def done(self):
        if self.index!=len(self.events):raise ValueError('unexpected extra node')

def same_bounds(r,values):
    if len(r)!=len(values) or any(not within(x,unhex(y)) for x,y in zip(r,values)):raise ValueError('stage output outside bound')

def complex_div(replay,y,h):
    ar,ai=ab(h[0]),ab(h[1]);scale=(max(ar[0],ai[0]),max(ar[1],ai[1]))
    if scale[0]<=0:raise ValueError('scale crosses zero; uncertified')
    op=replay.take
    a=op('div',[h[0],scale]);b=op('div',[h[1],scale])
    d=op('add',[op('mul',[a,a]),op('mul',[b,b])])
    u=op('div',[y[0],scale]);v=op('div',[y[1],scale])
    re=op('div',[op('add',[op('mul',[u,a]),op('mul',[v,b])]),d])
    im=op('div',[op('sub',[op('mul',[v,a]),op('mul',[u,b])]),d])
    return [re,im]

def audit(case):
    n=case['n'];events=case['events'];signal=[point(unhex(v)) for v in case['signal']]
    expected={'fir2-fft8':(8,[(0,1.,0.),(1,.25,.125)]),'fir3-fft16':(16,[(0,1.,0.),(1,.25,.125),(3,-.125,.0625)]),'fir4-rounded-fft8':(8,[(0,1.,0.),(1,.1,.2),(2,-.3,.1),(3,.2,-.1)])}
    if case['id'] not in expected or n!=expected[case['id']][0]:raise ValueError('unexpected fixture')
    if case['signal']!=[hx(((j*7)%11-5)/8) for j in range(2*n)]:raise ValueError('fixture signal changed')
    if case['taps']!=[{'delay':d,'i':hx(i),'q':hx(q)} for d,i,q in expected[case['id']][1]] or case['pilot']!=[hx(1.),hx(1.)]:raise ValueError('fixture taps or pilot changed')
    taps=[(t['delay'],point(unhex(t['i'])),point(unhex(t['q']))) for t in case['taps']]
    fir=Replay(events['fir']);out=[point(0.) for _ in range(len(signal)+2*taps[-1][0])]
    for delay,ti,tq in taps:
        for j in range(0,len(signal),2):
            k=j+2*delay
            out[k]=fir.take('add',[out[k],fir.take('sub',[fir.take('mul',[ti,signal[j]]),fir.take('mul',[tq,signal[j+1]])])])
            out[k+1]=fir.take('add',[out[k+1],fir.take('add',[fir.take('mul',[tq,signal[j]]),fir.take('mul',[ti,signal[j+1]])])])
    fir.done();same_bounds(out,case['fir'])
    f=Replay(events['fft']);v=out[:2*n];j=0
    for i in range(1,n):
        bit=n>>1
        while j & bit: j^=bit;bit>>=1
        j^=bit
        if i<j: v[2*i:2*i+2],v[2*j:2*j+2]=v[2*j:2*j+2],v[2*i:2*i+2]
    size=2
    while size<=n:
        for start in range(0,n,size):
            for j in range(size//2):
                a=2*(start+j);b=2*(start+j+size//2)
                angle=((-2*math.pi*j)/size)
                c=f.take('cos',[point(angle)],angle);s=f.take('sin',[point(angle)],angle)
                re=f.take('sub',[f.take('mul',[c,v[b]]),f.take('mul',[s,v[b+1]])])
                im=f.take('add',[f.take('mul',[s,v[b]]),f.take('mul',[c,v[b+1]])])
                v[b]=f.take('sub',[v[a],re]);v[b+1]=f.take('sub',[v[a+1],im])
                v[a]=f.take('add',[v[a],re]);v[a+1]=f.take('add',[v[a+1],im])
        size*=2
    scale=f.take('div',[point(1.),f.take('sqrt',[point(float(n))])])
    v=[f.take('mul',[x,scale]) for x in v];f.done();same_bounds(v,case['spectrum'])
    ls=Replay(events['ls']);pilot=[point(unhex(x)) for x in case['pilot']]
    csi=complex_div(ls,v[:2],pilot);ls.done();same_bounds(csi,case['csi'])
    zf=Replay(events['zf']);z=complex_div(zf,v[2:4],csi);zf.done();same_bounds(z,case['decision'])
    states=[graph.classify_sign(r,b) for r,b in zip(z,case['bits'])]
    if 'mismatch' in states:raise ValueError('decision mismatch')
    return {'id':case['id'],'input':{'n':n,'signal':case['signal'],'taps':case['taps'],'pilot':case['pilot']},'nodes':{k:len(x.trace) for k,x in [('fir',fir),('fft',f),('ls',ls),('zf',zf)]},'decision':states,'observedBits':case['bits'],'trace':{'fir':fir.trace,'fft':f.trace,'ls':ls.trace,'zf':zf.trace},'productionOutputs':{k:case[k] for k in ('fir','spectrum','csi','decision')}}

def main():
    start=time.perf_counter();tracemalloc.start()
    data=json.loads(pathlib.Path(sys.argv[1]).read_bytes()) if len(sys.argv)>1 else json.loads(subprocess.run(['node','scripts/v15-multidsp-public-node.mjs'],capture_output=True,text=True,check=True).stdout)
    if [x['id'] for x in data['cases']]!=['fir2-fft8','fir3-fft16','fir4-rounded-fft8']:raise ValueError('fixed cases changed')
    results=[audit(case) for case in data['cases']]
    print(json.dumps({'runtime':data['runtime'],'compiledSourceSha256':data['sources'],'results':results,'metrics':{'wallSeconds':time.perf_counter()-start,'tracemallocPeakBytes':tracemalloc.get_traced_memory()[1]},'limits':['public fixed inputs','instrumented compiled copy checked against uninstrumented stage outputs','signed-zero intermediate bits not interval-certified','no complete OFDM receiver or random study']},indent=2))
if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'error':str(exc),'partial':[{'trace':r.trace,'current':r.current} for r in Replay.instances]},indent=2),file=sys.stderr)
        raise
