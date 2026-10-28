"""Independent small CP-OFDM/CFO reference: direct DFT and scalar FIR only."""
import cmath
import hashlib
import json
import math
import struct


def dft(values, inverse=False):
    n = len(values)
    direction = 1 if inverse else -1
    return [sum(x * cmath.exp(direction * 2j * math.pi * k * t / n)
                for t, x in enumerate(values)) / math.sqrt(n) for k in range(n)]


def pairs(values):
    return [[v.real, v.imag] for v in values]


n, cp, guard, suffix = 8, 2, 3, 4
grids = [[complex(((k + 2) * (m + 3) % 7) - 3,
                  ((k + 1) * (m + 2) % 5) - 2) / 3
          for k in range(n)] for m in range(3)]
bodies = [dft(grid, True) for grid in grids]
wave = [x for body in bodies for x in body[-cp:] + body]
taps = [(0, 0.8 + 0.1j), (2, -0.2 + 0.3j)]
clean = [sum(gain * wave[t-delay] for delay, gain in taps
             if 0 <= t-delay < len(wave)) for t in range(len(wave) + 2)]
unrotated = [0j] * guard + clean + [0j] * suffix
noise = [complex((t % 5 - 2) / 40, (t % 7 - 3) / 50)
         for t in range(len(unrotated))]
short_cp = 1
short_wave = [x for body in bodies for x in body[-short_cp:] + body]
short_clean = [sum(gain * short_wave[t-delay] for delay, gain in taps
                   if 0 <= t-delay < len(short_wave)) for t in range(len(short_wave) + 2)]
short_fft = [dft(short_clean[m*(n+short_cp)+short_cp:(m+1)*(n+short_cp)])
             for m in range(len(grids))]
frequency = [sum(gain * cmath.exp(-2j * math.pi * k * delay/n) for delay, gain in taps)
             for k in range(n)]
cases = []
for cfo, phase in [(0, 0), (0.5, 0.37), (-0.375, -0.19), (1, 0)]:
    received = [x * cmath.exp(1j * (phase + 2*math.pi*cfo*t/n)) + noise[t]
                for t, x in enumerate(unrotated)]
    compensated = [r * cmath.exp(-1j * (phase + 2*math.pi*cfo*t/n))
                   for t, r in enumerate(received)]
    slots = [dft(received[guard + m*(n+cp) + cp:guard + m*(n+cp) + cp+n])
             for m in range(len(grids))]
    ideal = [dft(compensated[guard + m*(n+cp) + cp:guard + m*(n+cp) + cp+n])
             for m in range(len(grids))]
    cases.append(dict(cfo=cfo, phase=phase, received=pairs(received),
                      compensated=pairs(compensated),
                      rawFft=[pairs(v) for v in slots], idealFft=[pairs(v) for v in ideal]))
random_input = 'signallab-ofdm-sync-rng-v1|20261028|7|data|2'
random_state = list(struct.unpack('<4I', hashlib.sha256(random_input.encode('ascii')).digest()[:16]))
print(json.dumps(dict(n=n, cp=cp, guard=guard, suffix=suffix, randomInput=random_input, randomState=random_state, grids=[pairs(g) for g in grids],
                      shortCp=dict(cp=short_cp, wave=pairs(short_wave), clean=pairs(short_clean), fft=[pairs(v) for v in short_fft], frequency=pairs(frequency)),
                      wave=pairs(wave), taps=[dict(delay=d, i=h.real, q=h.imag) for d, h in taps],
                      noise=pairs(noise), cases=cases), separators=(',', ':')))
