"""Independent P1b correlator, window search, DFT, decision and failure reference."""
import contextlib
import io
import json
import math
import cmath
import runpy

with contextlib.redirect_stdout(io.StringIO()):
    ref = runpy.run_path('scripts/v15-reference.py')

N, GUARD, PREAMBLE, BITS = 128, 32, 256, 768

def estimate(samples, cp):
    nominal = GUARD + PREAMBLE + cp
    if len(samples) < nominal + 31 + N:
        return {'status': 'capture-failed', 'reason': 'insufficient-observation'}
    x, y = samples[96:160], samples[160:224]
    correlation = sum(a.conjugate()*b for a,b in zip(x,y))
    a, b = sum(abs(v)**2 for v in x), sum(abs(v)**2 for v in y)
    if a <= 1e-24 or b <= 1e-24:
        return {'status': 'capture-failed', 'reason': 'low-energy'}
    coherence = 2*abs(correlation)/(a+b)
    if not math.isfinite(coherence) or coherence < .1:
        return {'status': 'capture-failed', 'reason': 'low-coherence'}
    phase = cmath.phase(correlation)
    if phase >= math.pi:
        phase -= 2*math.pi
    cfo = N*phase/(2*math.pi*64)
    corrected = [v*cmath.exp(-2j*math.pi*cfo*t/N) for t,v in enumerate(samples)]
    training = ref['make_frame'](ref['cases'][0]['config'])[3]
    reference = ref['transform'](training, True)
    ref_energy = sum(abs(v)**2 for v in reference)
    scores = []
    for start in range(nominal-16, nominal+32):
        segment = corrected[start:start+N]
        power = sum(abs(v)**2 for v in segment)
        corr = sum(a.conjugate()*b for a,b in zip(reference,segment))
        scores.append(abs(corr)**2/(power*ref_energy) if power > 1e-24 else 0)
    index = max(range(len(scores)), key=scores.__getitem__)
    if scores[index] < .1:
        return {'status': 'capture-failed', 'reason': 'low-correlation'}
    peak = nominal-16+index
    return {'status': 'ok', 'cfo': cfo, 'coherence': coherence, 'peak': peak,
            'start': peak-min(7,cp), 'score': scores[index]}

def receive(frame, p, correction, useful_start):
    _, _, samples, training, payload, bins = frame
    cp_start = useful_start-p['cp']
    if cp_start < 0 or cp_start + 5*(N+p['cp']) > len(samples):
        return {'status': 'window-failed', 'bits': BITS, 'errors': 0, 'erasedBits': BITS}
    corrected = [v*cmath.exp(-2j*math.pi*correction*t/N) for t,v in enumerate(samples)]
    spectra = [ref['transform'](corrected[useful_start+m*(N+p['cp']):useful_start+m*(N+p['cp'])+N]) for m in range(5)]
    errors, erased = 0, 0
    for m in range(1,5):
        for k in bins:
            h = spectra[0][k]/training[k]
            if h == 0:
                erased += 2
                continue
            v = spectra[m][k]/h
            bits = [0 if v.real >= 0 else 1, 0 if v.imag >= 0 else 1]
            errors += sum(a != b for a,b in zip(bits,payload[m-1][k]))
    return {'status': 'ok', 'bits': BITS, 'errors': errors, 'erasedBits': erased}

def scenario(p, kind='normal'):
    frame = list(ref['make_frame'](p))
    if kind == 'zero': frame[2] = [0j] * len(frame[2])
    if kind == 'short': frame[2] = frame[2][:500]
    if kind == 'tiny': frame[2] = frame[2][:100]
    if kind in ('low-coherence', 'low-correlation'):
        frame[2] = [0j] * len(frame[2])
        for i in range(64):
            frame[2][96+i] = 1+0j
            frame[2][160+i] = (-1 if kind == 'low-coherence' and i % 2 else 1)+0j
    acq = estimate(frame[2], p['cp'])
    raw = receive(frame, p, 0, GUARD+PREAMBLE+p['cp'])
    ideal = receive(frame, p, p['cfo'], GUARD+p['sto']+PREAMBLE+p['cp'])
    estimated = (receive(frame,p,acq['cfo'],acq['start']) if acq['status'] == 'ok'
                 else {'status':'capture-failed','bits':BITS,'errors':0,'erasedBits':BITS})
    return {'config': p, 'kind': kind, 'raw': raw, 'ideal': ideal, 'estimated': estimated, 'acquisition': acq}

cases = [scenario(c['config']) for c in ref['cases']]
cases += [scenario({**ref['cases'][0]['config'], 'frameId': 50+i,
                    'taps': [{'delay': 0, 'i': 1, 'q': 0}],
                    'cfo': cfo, 'sto': sto, 'noisePower': noise})
          for i, (cfo, sto, noise) in enumerate([(0, 0, 0), (.25, 8, .15)])]
cases += [scenario(ref['cases'][0]['config'], kind) for kind in ['zero', 'short', 'tiny', 'low-coherence', 'low-correlation']]
print(json.dumps(cases, separators=(',', ':')))
