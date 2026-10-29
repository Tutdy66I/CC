"""Independent P1a single-frame reference: standard-library DFT and FIR."""
import cmath
import hashlib
import json
import math
import struct

N = 128
MASK = 0xffffffff
DOMAIN = 'signallab-v15-p1a-test-rng-v1'

def rng(frame, role, slot):
    state = list(struct.unpack('<4I', hashlib.sha256(
        f'{DOMAIN}|{frame}|{role}|{slot}'.encode('ascii')).digest()[:16]))
    def rot(x, n):
        return ((x << n) | (x >> (32 - n))) & MASK
    while True:
        result = (rot((state[1] * 5) & MASK, 7) * 9) & MASK
        t = (state[1] << 9) & MASK
        state[2] ^= state[0]
        state[3] ^= state[1]
        state[1] ^= state[2]
        state[0] ^= state[3]
        state[2] ^= t
        state[3] = rot(state[3], 11)
        yield result / 2**32

def transform(xs, inverse=False):
    sign = 1 if inverse else -1
    return [sum(x * cmath.exp(sign * 2j * math.pi * k * t / N)
                for t, x in enumerate(xs)) / math.sqrt(N) for k in range(N)]

def pairs(xs):
    return [[z.real, z.imag] for z in xs]

def make_frame(p):
    bins = list(range(80, 128)) + list(range(1, 49))
    # Match the repository's standard signed-bin order, independently computed.
    training = [0j] * N
    for k in bins:
        code = ((13*k + 7) ^ (k >> 2)) & 3
        training[k] = complex(-1 if code & 1 else 1, -1 if code & 2 else 1)
    grids, payload = [training], []
    for m in range(4):
        source, grid, bits = rng(p['frameId'], 'data', m), [0j] * N, {}
        for k in range(N):
            b = [0 if next(source) < .5 else 1 for _ in range(4)]
            if k in bins:
                bits[k] = b[:2]
                grid[k] = complex(1 if b[0] == 0 else -1, 1 if b[1] == 0 else -1)
        grids.append(grid)
        payload.append(bits)
    preamble = []
    for i in range(256):
        value = (((i % 64) + 1) * 0x9e3779b1) & MASK
        value ^= value >> 16
        value = (value * 0x85ebca6b) & MASK
        value ^= value >> 13
        preamble.append(complex(1 if value & 1 else -1, 1 if value & 2 else -1) / math.sqrt(2))
    wave = preamble[:]
    for grid in grids:
        body = transform(grid, True)
        wave.extend(body[-p['cp']:] if p['cp'] else [])
        wave.extend(body)
    max_delay = p['taps'][-1]['delay']
    filtered = [sum(complex(t['i'], t['q']) * wave[n-t['delay']]
                    for t in p['taps'] if 0 <= n-t['delay'] < len(wave))
                for n in range(len(wave) + max_delay)]
    padded = [0j] * (32+p['sto']) + filtered + [0j] * (32-p['sto'])
    source = rng(p['frameId'], 'noise', 0)
    noise = []
    for _ in padded:
        radius = math.sqrt(-2*math.log(1-next(source))) / math.sqrt(2) * math.sqrt(p['noisePower'])
        angle = 2*math.pi*next(source)
        noise.append(radius * cmath.exp(1j*angle))
    capture = [x * cmath.exp(1j*(p['phase'] + 2*math.pi*p['cfo']*n/N)) + noise[n]
               for n, x in enumerate(padded)]
    return wave, noise, capture, training, payload, bins

def measure(frame, p, e, delta, remove_phase=False):
    _, _, capture, training, payload, bins = frame
    corrected = [x * cmath.exp(-1j*(2*math.pi*(p['cfo']-e)*n/N + (p['phase'] if remove_phase else 0)))
                 for n, x in enumerate(capture)]
    start = 32 + p['sto'] + 256 + p['cp'] + delta
    if start < p['cp'] or start - p['cp'] + 5 * (N + p['cp']) > len(capture):
        raise ValueError('incomplete receiver window')
    spectra = [transform(corrected[start + m*(N+p['cp']):start + m*(N+p['cp']) + N]) for m in range(5)]
    errors = 0
    for m in range(1, 5):
        for k in bins:
            h = spectra[0][k] / training[k]
            z = spectra[m][k] / h
            bits = [0 if z.real >= 0 else 1, 0 if z.imag >= 0 else 1]
            errors += sum(a != b for a, b in zip(bits, payload[m-1][k]))
    return {'bits': 768, 'errors': errors, 'erasedBits': 0}, spectra[0]

def case(p, e, delta):
    frame = make_frame(p)
    ed, spectrum = measure(frame, p, e, delta)
    e0, _ = measure(frame, p, e, 0)
    zd, _ = measure(frame, p, 0, delta)
    z0, _ = measure(frame, p, 0, 0)
    ideal, _ = measure(frame, p, 0, 0, remove_phase=True)
    cross = (ed['errors'] - e0['errors'] - zd['errors'] + z0['errors']) / 768
    return {'config': p, 'e': e, 'delta': delta, 'wave': pairs(frame[0]),
            'noise': pairs(frame[1]), 'capture': pairs(frame[2]), 'spectrum': pairs(spectrum),
            'metrics': {'ed': ed, 'e0': e0, 'zD': zd, 'z0': z0}, 'ideal': ideal,
            'interaction': cross}

taps = [{'delay': 0, 'i': .8, 'q': .1}, {'delay': 3, 'i': .2, 'q': -.1},
        {'delay': 7, 'i': .1, 'q': .05}]
cases = []
for index, (cfo, sto, cp, e, delta) in enumerate([
        (0, 0, 16, .16, -11), (.25, 0, 16, -.19, -10),
        (0, 8, 16, .2, 2), (.25, 8, 16, -.2, -12),
        (-.35, -8, 3, .22, -3)]):
    config = {'frameId': index, 'cp': cp, 'cfo': cfo, 'sto': sto,
              'phase': .31, 'taps': taps, 'noisePower': .15}
    cases.append(case(config, e, delta))
# Independently enumerate all useful sample/path indices inside the transmitted CP symbol.
windows = []
for cp, delays in [(16, [0, 3, 7]), (3, [0, 3, 7]), (0, [0]), (8, [3, 7])]:
    for delta in range(-12, 13):
        safe = all(0 <= cp + delta + sample - delay < cp + N
                   for sample in range(N) for delay in delays)
        windows.append({'cp': cp, 'delays': delays, 'delta': delta, 'safe': safe})
outside = []
frame = make_frame(cases[0]['config'])
for delta in (-1000, 1000):
    try:
        measure(frame, cases[0]['config'], 0, delta)
        outside.append(False)
    except ValueError:
        outside.append(True)
print(json.dumps({'domain': DOMAIN, 'cases': cases, 'windows': windows, 'outside': outside}, separators=(',', ':')))
