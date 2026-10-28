"""Independent repeated-training CFO and known-training timing vectors."""
import cmath
import hashlib
import json
import math
import struct


def pair(values):
    return [[value.real, value.imag] for value in values]


def reference(samples, start, lag, count, n):
    correlation = sum(samples[start+i].conjugate()*samples[start+i+lag] for i in range(count))
    a = sum(abs(samples[start+i])**2 for i in range(count))
    b = sum(abs(samples[start+i+lag])**2 for i in range(count))
    return dict(cfo=n*cmath.phase(correlation)/(2*math.pi*lag),
                coherence=2*abs(correlation)/(a+b))


n = 128
def public_symbol(i):
    value = ((i+1)*0x9e3779b1) & 0xffffffff
    value ^= value >> 16
    value = (value*0x85ebca6b) & 0xffffffff
    value ^= value >> 13
    return complex(1 if value & 1 else -1, 1 if value & 2 else -1)/math.sqrt(2)


a = [public_symbol(i) for i in range(64)]
signal = a*4
taps = [(0, .8+.1j), (3, -.2+.3j), (7, .1-.08j)]
filtered = [sum(h*signal[t-d] for d,h in taps if 0 <= t-d < len(signal))
            for t in range(len(signal)+7)]
vectors = []
for cfo, phase, noisy in [(0, 0, False), (.375, .3, False), (-.75, -.4, False),
                           (1.25, .1, False), (.2, .2, True)]:
    received = [v*cmath.exp(1j*(phase+2*math.pi*cfo*i/n)) +
                (complex((i % 7)-3,(i % 5)-2)/200 if noisy else 0)
                for i,v in enumerate(filtered)]
    vectors.append(dict(inputCfo=cfo, samples=pair(received),
                        expected=reference(received, 64, 64, 64, n)))
training = [complex((i*7 % 11)-5, (i*i % 13)-6)/7 for i in range(16)]
timing = []
for shift, noise in [(0, False), (3, False), (-3, True)]:
    source = [0j]*40
    source[12+shift:12+shift+len(training)] = training
    received = [sum(h*source[t-d] for d,h in [(0,.8+.2j),(3,.2-.1j)] if 0 <= t-d < len(source))
                + (complex((t % 5)-2,(t % 7)-3)/500 if noise else 0) for t in range(len(source))]
    scores = []
    for start in range(4,21):
        window = received[start:start+len(training)]
        correlation = sum(p.conjugate()*x for p,x in zip(training,window))
        energy = sum(abs(x)**2 for x in window)*sum(abs(x)**2 for x in training)
        scores.append(abs(correlation)**2/energy if energy else 0)
    best = 4+max(range(len(scores)),key=scores.__getitem__)
    timing.append(dict(samples=pair(received), best=best, start=best-2, score=scores[best-4]))
# Independent full-waveform CP-OFDM acquisition reference.
cp, sto, guard, epsilon, phase = 16, 7, 32, .3, .21
def inverse(grid):
    return [sum(x*cmath.exp(2j*math.pi*k*t/n) for k,x in enumerate(grid))/math.sqrt(n) for t in range(n)]

training_grid, data_grid = [0j]*n, [0j]*n
for signed in list(range(-48,0))+list(range(1,49)):
    k = signed % n
    code = ((13*k+7) ^ (k >> 2)) & 3
    training_grid[k] = complex(-1 if code & 1 else 1, -1 if code & 2 else 1)
    data_grid[k] = complex(-1 if k & 1 else 1, -1 if k & 2 else 1)
body, data_body = inverse(training_grid), inverse(data_grid)
wave = a*4+body[-cp:]+body+data_body[-cp:]+data_body
joint_taps = [(0,.8+.1j),(3,.2-.1j),(7,.1+.05j)]
joint_fir = [sum(h*wave[t-d] for d,h in joint_taps if 0 <= t-d < len(wave)) for t in range(len(wave)+7)]
padded = [0j]*(guard+sto)+joint_fir+[0j]*(guard-sto)
joint_noise = [complex((i%7)-3,(i%5)-2)/1000 for i in range(len(padded))]
joint_received = [x*cmath.exp(1j*(phase+2*math.pi*epsilon*i/n))+joint_noise[i] for i,x in enumerate(padded)]
joint_cfo = reference(joint_received,96,64,64,n)
joint_corrected = [x*cmath.exp(-2j*math.pi*joint_cfo['cfo']*i/n) for i,x in enumerate(joint_received)]
nominal, scores = guard+256+cp, []
for start in range(nominal-16,nominal+16+15+1):
    window = joint_corrected[start:start+n]
    c = sum(p.conjugate()*x for p,x in zip(body,window))
    energy = sum(abs(x)**2 for x in window)*sum(abs(x)**2 for x in body)
    scores.append(abs(c)**2/energy if energy else 0)
peak = nominal-16+max(range(len(scores)),key=scores.__getitem__)
joint = dict(wave=pair(wave), noise=pair(joint_noise), received=pair(joint_received), cp=cp, sto=sto,
             cfo=epsilon, phase=phase, taps=[dict(delay=d,i=h.real,q=h.imag) for d,h in joint_taps],
             expected=dict(cfo=joint_cfo['cfo'],coherence=joint_cfo['coherence'],peak=peak,start=peak-7,
                           score=scores[peak-(nominal-16)]))
random_input = 'signallab-ofdm-sync-joint-rng-v1|20261028|7|data|2'
random_state = list(struct.unpack('<4I', hashlib.sha256(random_input.encode('ascii')).digest()[:16]))
print(json.dumps(dict(n=n, lag=64, start=64, count=64, preamble=pair(a*4), vectors=vectors, joint=joint,
                      randomInput=random_input, randomState=random_state,
                      timingReference=pair(training), timing=timing), separators=(',', ':')))
