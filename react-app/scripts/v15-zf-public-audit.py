"""Public ZF trace audit; refinement assumes RN-ties-even per basic operation."""
import copy, importlib.util, json, math, pathlib, subprocess, time, tracemalloc
from fractions import Fraction

spec=importlib.util.spec_from_file_location('graph',pathlib.Path(__file__).with_name('v15-interval-public-audit.py'))
graph=importlib.util.module_from_spec(spec);spec.loader.exec_module(graph)

class NearestGraph(graph.Graph):
    def rounded(self,name,lo,hi):
        # Do not assume a correctly rounded transcendental: keep the existing
        # outward sqrt enclosure and refine only basic IEEE operations.
        if name == 'sqrt2.enclosure': return super().rounded(name,lo,hi)
        if lo > hi: raise ValueError('invalid interval')
        a,b=float(lo),float(hi)
        if not math.isfinite(a) or not math.isfinite(b): raise ValueError('nonfinite interval')
        self.trace.append({'node':name,'lower':graph.hx(a),'upper':graph.hx(b)})
        return Fraction.from_float(a),Fraction.from_float(b)

def span(entry): return (Fraction.from_float(graph.unhex(entry['lower'])),Fraction.from_float(graph.unhex(entry['upper'])))
def exact(x): return Fraction.from_float(graph.unhex(x))
def main():
    start=time.perf_counter();tracemalloc.start()
    node=json.loads(subprocess.run(['node','scripts/v15-zf-trace-public.mjs'],check=True,text=True,capture_output=True).stdout)
    old=graph.audit(node['fixture'],node['nodeConstants'])
    original=graph.Graph
    try:
        graph.Graph=NearestGraph
        refined=graph.audit(node['fixture'],node['nodeConstants'])
    finally: graph.Graph=original
    old_zf={x['node']:x for x in old['trace'] if x['node'].startswith('zf.')}
    new_zf={x['node']:x for x in refined['trace'] if x['node'].startswith('zf.')}
    observed={x['name']:x['bits'] for x in node['trace']}
    if len(observed)!=len(node['trace']) or set(observed)-{'scale'} != set(old_zf) or set(old_zf)!=set(new_zf): raise ValueError('missing or duplicate trace node')
    rows=[]
    for entry in node['trace']:
        name=entry['name']
        if name=='scale':
            expected=max(abs(graph.unhex(x)) for x in node['fixture']['h'])
            valid=entry['bits']==graph.hx(expected)
            rows.append({'name':name,'observed':entry['bits'],'exactExpected':graph.hx(expected),'withinBaseline':valid,'withinRefined':valid})
            continue
        value=graph.unhex(entry['bits']); baseline=span(old_zf[name]); tight=span(new_zf[name])
        if tight[0]<baseline[0] or tight[1]>baseline[1]: raise ValueError('refinement widened')
        rows.append({'name':name,'observed':entry['bits'],'baseline':old_zf[name],'refined':new_zf[name],
                     'withinBaseline':graph.check(baseline,value),'withinRefined':graph.check(tight,value)})
    # Independent exact rational operations conditional on the observed upstream
    # operands. This checks each basic rounding step; it does not certify FFT input.
    h=list(map(exact,node['fixture']['h'])); y=list(map(exact,node['fixture']['fft'][:2])); o={k:exact(v) for k,v in observed.items()}
    s=o['scale']; a=o['zf.a']; b=o['zf.b']; d=o['zf.d']; u=o['zf.u']; v=o['zf.v']
    expressions={'zf.a':h[0]/s,'zf.b':h[1]/s,'zf.a2':a*a,'zf.b2':b*b,
      'zf.d':o['zf.a2']+o['zf.b2'],'zf.u':y[0]/s,'zf.v':y[1]/s,
      'zf.ua':u*a,'zf.vb':v*b,'zf.re.numerator':o['zf.ua']+o['zf.vb'],
      'zf.re':o['zf.re.numerator']/d,'zf.va':v*a,'zf.ub':u*b,
      'zf.im.numerator':o['zf.va']-o['zf.ub'],'zf.im':o['zf.im.numerator']/d}
    checks=[{'node':name,'expected':graph.hx(float(value)),'observed':observed[name],
             'matches':graph.hx(float(value))==observed[name]} for name,value in expressions.items()]
    crossing=[r['name'] for r in rows if r['name']!='scale' and span(r['baseline'])[0]<0<span(r['baseline'])[1]]
    altered=copy.deepcopy(node['fixture']); original_fft=altered['fft'][0]
    altered['fft'][0]='4059000000000000'  # Deliberate public test corruption, not production output.
    probe=graph.audit(altered,node['nodeConstants'])
    mismatch_probe={'source':'deliberately-altered-public-test','field':'fft[0]',
                    'original':original_fft,'altered':altered['fft'][0],
                    'detectedNodes':probe['mismatch'],'status':'mismatch' if 'fft[0]' in probe['mismatch'] else 'not-detected'}
    peak=tracemalloc.get_traced_memory()[1]
    print(json.dumps({'fixture':node,'checks':rows,'conditionalRounding':checks,'firstStrictCrossing':crossing[0] if crossing else None,
       'baselineDecision':old['decision'],'refinedDecision':refined['decision'],'syntheticMismatchProbe':mismatch_probe,
       'metrics':{'wallSeconds':time.perf_counter()-start,'tracemallocPeakBytes':peak},
       'limits':['in-memory source instrumentation may affect optimization; final outputs compared to unmodified production',
                 'refinement assumes basic operations and Python Fraction conversion use RN-ties-even',
                 'conditional exact checks assume the observed FFT inputs; signed-zero bits are not generally certified']},indent=2))
    if old['mismatch'] or refined['mismatch'] or mismatch_probe['status']!='mismatch' or any(not r['withinBaseline'] or not r['withinRefined'] for r in rows) or any(not r['matches'] for r in checks): raise SystemExit(1)
if __name__=='__main__': main()
