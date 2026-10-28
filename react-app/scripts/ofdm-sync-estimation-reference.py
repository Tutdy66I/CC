"""Independent repeated-training CFO and known-training timing vectors."""
import cmath
import json
import math


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
print(json.dumps(dict(n=n, lag=64, start=64, count=64, preamble=pair(a*4), vectors=vectors,
                      timingReference=pair(training), timing=timing), separators=(',', ':')))
