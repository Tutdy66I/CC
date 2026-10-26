"""Independent O(N^2) cmath DFT, direct FIR, explicit Toeplitz and scalar formulas.

No production imports, project random generator or simulated answers are used.
Run with no arguments to regenerate the committed deterministic fixture on stdout.
"""
import cmath
import hashlib
import json
import math
import struct


def pairs(xs):
    return [[z.real, z.imag] for z in xs]


def dft(xs, inverse=False):
    n = len(xs)
    sign = 1 if inverse else -1
    return [sum(x * cmath.exp(sign*2j*math.pi*k*t/n) for t, x in enumerate(xs))/math.sqrt(n) for k in range(n)]


def fir(xs, taps):
    return [sum(h*xs[t-d] for d, h in taps if 0 <= t-d < len(xs)) for t in range(len(xs)+max(d for d, _ in taps))]


transforms = []
for n in [8, 16, 32]:
    for name, x in [
        ('impulse', [1+0j]+[0j]*(n-1)),
        ('constant', [1-2j]*n),
        ('negative-tone', [cmath.exp(-2j*math.pi*t/n) for t in range(n)]),
        ('nyquist', [complex((-1)**t) for t in range(n)]),
        ('complex', [complex((t*7 % 13)-6, (t*t % 11)-5)/7 for t in range(n)]),
    ]:
        transforms.append(dict(name=f'{n}-{name}', x=pairs(x), forward=pairs(dft(x)), inverse=pairs(dft(x, True))))

channels = []
for cp in [0, 2, 3]:
    n = 8
    grids = [[complex(((k+1)*(m+2) % 11)-5, ((k+3)*(m+1) % 7)-3)/3 for k in range(n)] for m in range(3)]
    bodies = [dft(g, True) for g in grids]
    signal = [z for body in bodies for z in ((body[-cp:] if cp else [])+body)]
    taps = [(1, .8+.2j), (3, -.3+.1j)]
    direct = fir(signal, taps)
    # Explicit full linear channel matrix, including first-symbol zero prehistory.
    matrix = [[sum(h for d, h in taps if row-col == d) for col in range(len(signal))] for row in range(len(direct))]
    product = [sum(a*b for a, b in zip(row, signal)) for row in matrix]
    assert max(abs(a-b) for a, b in zip(direct, product)) < 1e-12
    responses = [dft(direct[m*(n+cp)+cp:(m+1)*(n+cp)]) for m in range(3)]
    h = [sum(g*cmath.exp(-2j*math.pi*k*d/n) for d, g in taps) for k in range(n)]
    residual = [sum(abs(y-hk*x)**2 for y, hk, x in zip(r, h, g)) for r, g in zip(responses, grids)]
    channels.append(dict(cp=cp, n=n, grids=[pairs(g) for g in grids], taps=[dict(delay=d, i=g.real, q=g.imag) for d, g in taps], signal=pairs(signal), output=pairs(direct), received=[pairs(r) for r in responses], response=pairs(h), residual=residual))

random_input = 'signallab-ofdm-rng-v1|20261026|7|data|2'
random_state = list(struct.unpack('<4I', hashlib.sha256(random_input.encode('ascii')).digest()[:16]))

# Independent fixed training CP energy, including coherent public-pilot structure.
energy = []
for bits in [1, 2, 4]:
    n, cp, symbols = 128, 16, 4
    active = list(range(-48, 0))+list(range(1, 49))
    grid = [0j]*n
    for signed in active:
        k = signed % n
        code = ((13*k+7) ^ (k >> 2)) & 3
        grid[k] = complex(-1 if code & 1 else 1, -1 if code & 2 else 1)*math.sqrt(bits/2)
    body = dft(grid, True)
    training_cp = sum(abs(z)**2 for z in body[-cp:])
    useful = (1+symbols)*len(active)*bits
    expected_cp = training_cp+symbols*cp/n*len(active)*bits
    energy.append(dict(bits=bits, trainingCp=training_cp, expectedTotal=useful+expected_cp, ebTotal=(useful+expected_cp)/(symbols*len(active)*bits)))

equalizers = []
for h, estimate, y, n0, es in [(1+.2j, .8+.1j, -2+.7j, .25, 4), (.00000001+2e-8j, 1e-8+2e-8j, 1-.5j, 1, 2)]:
    for method in ['zf', 'mmse']:
        w = 1/estimate if method == 'zf' else estimate.conjugate()/(abs(estimate)**2+n0/es)
        gain = 1 if method == 'zf' else abs(estimate)**2/(abs(estimate)**2+n0/es)
        equalizers.append(dict(h=pairs([h])[0], estimate=pairs([estimate])[0], y=pairs([y])[0], n0=n0, es=es, method=method, raw=pairs([w*y])[0], decision=pairs([y/estimate])[0], gain=gain, conditionalMse=es*abs(w*h-1)**2+n0*abs(w)**2))

print(json.dumps(dict(version=1, transforms=transforms, channels=channels, energy=energy, randomInput=random_input, randomState=random_state, equalizers=equalizers, awgnBer={str(db):.5*math.erfc(math.sqrt(10**(db/10))) for db in [0, 4, 8]}), separators=(',', ':')))
