"""Offline analytical fixtures; independent Python stdlib implementation, no PRNG.

Run with Python 3. These fixture values are copied into carrier-offset.test.ts.
Uses direct unwrapped angles and erfc-integrated decision regions, not TS helpers.
"""
import math


def reference(modulation, phase, frequency, bits=1024, db=4):
    width = {"BPSK": 1, "QPSK": 2, "16QAM": 4}[modulation]
    sigma = math.sqrt(1 / (2 * 10 ** (db / 10)))
    scale = math.sqrt(2 / 5)

    def bit(index):
        return ((index // 4 % 16) >> (3 - index % 4)) & 1

    def cdf(x):
        return math.erfc(-x / math.sqrt(2)) / 2

    total = 0
    for n in range(bits // width):
        k = n * width
        ci = bit(k) * 2 + bit(k + 1) if width == 4 else bit(k)
        cq = bit(k + 2) * 2 + bit(k + 3) if width == 4 else bit(k + 1)
        si = [-3, -1, 3, 1][ci] * scale if width == 4 else 1 - 2 * ci
        sq = 0 if width == 1 else ([-3, -1, 3, 1][cq] * scale if width == 4 else 1 - 2 * cq)
        angle = math.radians(phase) + 2 * math.pi * frequency * n
        mi = si * math.cos(angle) - sq * math.sin(angle)
        mq = si * math.sin(angle) + sq * math.cos(angle)
        if width == 4:
            cuts = [-math.inf, -2 * scale, 0, 2 * scale, math.inf]
            for code, mean in [(ci, mi), (cq, mq)]:
                for j, decoded in enumerate([0, 1, 3, 2]):
                    probability = cdf((cuts[j + 1] - mean) / sigma) - cdf((cuts[j] - mean) / sigma)
                    total += (code ^ decoded).bit_count() * probability
        else:
            total += cdf(-si * mi / sigma)
            if width == 2:
                total += cdf(-sq * mq / sigma)
    return total / bits


if __name__ == "__main__":
    for mod in ["BPSK", "QPSK", "16QAM"]:
        for phase, frequency in [(23, -.0007), (-17, .0013), (30, 0)]:
            print(mod, phase, frequency, repr(reference(mod, phase, frequency)))
