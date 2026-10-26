"""Independent standard-library reference: direct unitary DFT, FIR, complex LS.
No production imports, FFT packages, RNG or generated TypeScript answers.
Print JSON; numerical tolerance is specified by the consumer, not by rounding.
"""
import cmath
import json
import math


def dft(x, inverse=False):
    n = len(x)
    sign = 1 if inverse else -1
    return [sum(v * cmath.exp(sign * 2j * math.pi * k * t / n)
                for t, v in enumerate(x)) / math.sqrt(n) for k in range(n)]


def interpolate(pos, values, targets):
    result = []
    noise_weights = []
    for q in targets:
        if q in pos:
            result.append(values[pos.index(q)])
            noise_weights.append(1)
            continue
        j = next(j for j in range(len(pos)-1) if pos[j] < q < pos[j+1])
        b = (q-pos[j])/(pos[j+1]-pos[j])
        result.append((1-b)*values[j] + b*values[j+1])
        noise_weights.append((1-b)**2+b**2)
    return result, noise_weights


def pilot(k, es=2):
    code = ((13*k+7) ^ (k >> 2)) & 3
    return complex(-1 if code & 1 else 1, -1 if code & 2 else 1)*math.sqrt(es/2)


def pairs(x):
    return [[v.real, v.imag] for v in x]


active = list(range(-24, 0))+list(range(1, 25))
layouts = [[-24, -8, 8, 24], [-24, -17, -10, -3, 3, 10, 17, 24],
           [-24, -21, -18, -14, -11, -8, -5, -2, 2, 5, 8, 11, 14, 18, 21, 24]]
vectors = []
for name, pos, h in [
    ('flat', [-24, -8, 8, 24], [complex(.7, -.4)]*4),
    ('affine-cross-dc', [-24, -3, 8, 24],
     [complex(.2+.03*q, -.6-.02*q) for q in [-24, -3, 8, 24]]),
]:
    y, weights = interpolate(pos, h, active)
    vectors.append(dict(name=name, positions=pos, values=pairs(h),
                        targets=active, estimate=pairs(y), weights=weights))

floors = []
for delay in [1, 7]:
    truth = [1+.6j*cmath.exp(-2j*math.pi*q*delay/64) for q in active]
    for pos in layouts:
        data = [q for q in active if q not in pos]
        h = [1+.6j*cmath.exp(-2j*math.pi*q*delay/64) for q in pos]
        estimated, weights = interpolate(pos, h, data)
        bias = sum(abs(v-(1+.6j*cmath.exp(-2j*math.pi*q*delay/64)))**2
                   for q, v in zip(data, estimated))/len(data)
        floors.append(dict(delay=delay, positions=pos, bias=bias,
                           mse0=bias+sum(weights)/len(data)/2,
                           mse40=bias+1e-4*sum(weights)/len(data)/2))

frames = []
for cp, pos in [(c, p) for c in [2, 3] for p in layouts[:2]]:
    n, symbols = 64, 2
    data = [q for q in active if q not in pos]
    training = [pilot(k) if (k if k < n/2 else k-n) in active else 0j for k in range(n)]
    pilot_grid = [pilot(k) if (k if k < n/2 else k-n) in pos else 0j for k in range(n)]
    virtual = [[complex(1 if (k+m)%3 else -1, -1 if (k+2*m)%5 else 1)
                for k in range(n)] for m in range(symbols)]
    grids = [training]+[[pilot_grid[k] if (k if k < n/2 else k-n) in pos
                        else virtual[m][k] if (k if k < n/2 else k-n) in data else 0j
                        for k in range(n)] for m in range(symbols)]
    bodies = [dft(g, True) for g in grids]
    wave = sum([x[-cp:]+x for x in bodies], [])
    taps = [(0, complex(.8, .1)), (3, complex(.3, -.2))]
    clean = [sum(h*wave[t-d] for d, h in taps if 0 <= t-d < len(wave))
             for t in range(len(wave)+3)]
    # Deterministic noisy observations, independent of any production generator.
    noise = [complex(math.sin(.37*t), math.cos(.23*t))*.01 for t in range(len(wave))]
    rx = [dft([clean[m*(n+cp)+cp+t]+noise[m*(n+cp)+cp+t] for t in range(n)])
          for m in range(symbols+1)]
    truth = [sum(h*cmath.exp(-2j*math.pi*k*d/n) for d, h in taps) for k in range(n)]
    training_ls = [rx[0][q % n]/training[q % n] for q in active]
    comb_ls = [[g[q % n]/pilot_grid[q % n] for q in pos] for g in rx[1:]]
    comb = [interpolate(pos, h, active)[0] for h in comb_ls]
    px = dft(pilot_grid, True)
    dx = [dft([virtual[m][k] if (k if k < n/2 else k-n) in data else 0j
               for k in range(n)], True) for m in range(symbols)]
    energy = dict(useful=sum(abs(v)**2 for g in grids for v in g),
                  cp=sum(abs(v)**2 for x in bodies for v in x[-cp:]),
                  trainingCp=sum(abs(v)**2 for v in bodies[0][-cp:]),
                  dataCp=sum(abs(v)**2 for x in dx for v in x[-cp:]),
                  pilotCp=symbols*sum(abs(v)**2 for v in px[-cp:]),
                  crossCp=sum(2*(a*b.conjugate()).real for x in dx
                              for a, b in zip(x[-cp:], px[-cp:])))
    expected_cp = energy['trainingCp']+symbols*(cp/n*len(data)*2+sum(abs(v)**2 for v in px[-cp:]))
    frames.append(dict(n=n, cp=cp, positions=pos, active=active,
                       virtual=[pairs(g) for g in virtual], grids=[pairs(g) for g in grids],
                       wave=pairs(wave), noise=pairs(noise), output=pairs(clean),
                       taps=[dict(delay=d, i=h.real, q=h.imag, power=abs(h)**2) for d, h in taps],
                       received=[pairs(g) for g in rx], truth=pairs(truth),
                       trainingLs=pairs(training_ls), pilotLs=[pairs(h) for h in comb_ls],
                       interpolated=[pairs(h) for h in comb], energy=energy,
                       expectedCp=expected_cp, expectedEbTotal=((symbols+1)*len(active)*2+expected_cp)/(symbols*len(data)*2)))

print(json.dumps(dict(vectors=vectors, floors=floors, frames=frames), separators=(',', ':')))
