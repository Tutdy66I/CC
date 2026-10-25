"""Independent scalar references for SignalLab v1.2 (Python stdlib only).

No TypeScript imports, Monte Carlo generator, or project simulation helpers.
Eb(data)=1; the 16QAM axis levels are sqrt(2/5)*[-3,-1,1,3].
"""

import argparse
import json
import math


def awgn_ber(modulation, gamma):
    """Exact equiprobable Gray-map BER from Gaussian decision regions."""
    if not math.isfinite(gamma) or gamma < 0:
        raise ValueError("gamma must be finite and nonnegative")
    if modulation not in ("BPSK", "QPSK", "16QAM"):
        raise ValueError("unknown modulation")
    if gamma == 0:
        return 0.5
    if modulation in ("BPSK", "QPSK"):
        return math.erfc(math.sqrt(gamma)) / 2
    scale = math.sqrt(2 / 5)
    sigma = math.sqrt(1 / (2 * gamma))
    levels = [-3 * scale, -scale, scale, 3 * scale]
    cuts = [-math.inf, -2 * scale, 0, 2 * scale, math.inf]
    labels = [0, 1, 3, 2]
    total = 0.0
    for source, mean in enumerate(levels):
        for decoded in range(4):
            lo = (cuts[decoded] - mean) / sigma
            hi = (cuts[decoded + 1] - mean) / sigma
            # Use reflected tails on the negative axis to avoid subtracting
            # two values near two in high-SNR error regions.
            if hi <= 0:
                probability = (math.erfc(-hi / math.sqrt(2)) - math.erfc(-lo / math.sqrt(2))) / 2
            else:
                probability = (math.erfc(lo / math.sqrt(2)) - math.erfc(hi / math.sqrt(2))) / 2
            total += (labels[source] ^ labels[decoded]).bit_count() * probability / 8
    return total


def _adaptive(f, left, right, tolerance, depth=18):
    midpoint = (left + right) / 2
    fa, fm, fb = f(left), f(midpoint), f(right)
    whole = (right - left) * (fa + 4 * fm + fb) / 6

    def refine(a, b, va, vm, vb, estimate, eps, remaining):
        m = (a + b) / 2
        vl, vr = f((a + m) / 2), f((m + b) / 2)
        first = (m - a) * (va + 4 * vl + vm) / 6
        second = (b - m) * (vm + 4 * vr + vb) / 6
        delta = first + second - estimate
        if abs(delta) <= 15 * eps:
            return first + second + delta / 15
        if remaining == 0:
            raise ArithmeticError("reference quadrature did not converge")
        return refine(a, m, va, vl, vm, first, eps / 2, remaining - 1) + refine(
            m, b, vm, vr, vb, second, eps / 2, remaining - 1
        )

    return refine(left, right, fa, fm, fb, whole, tolerance, depth)


def rayleigh_integral(modulation, gamma):
    """Integrate BER(gamma*g) exp(-g) dg; t=gamma*g=u^2.

    Independent 64-panel adaptive Simpson integration removes the square-root
    endpoint singularity. The omitted positive tail is below exp(-144) at
    low gamma, and below the 16QAM decision tail at u=16 otherwise.
    """
    if not math.isfinite(gamma) or gamma <= 0:
        raise ValueError("gamma must be finite and positive")
    limit = min(16.0, 12 * math.sqrt(gamma))

    def density(u):
        return 2 * u / gamma * awgn_ber(modulation, u * u) * math.exp(-u * u / gamma)

    return sum(_adaptive(density, limit * j / 64, limit * (j + 1) / 64, 1e-13 / 64) for j in range(64))


def rayleigh_closed(gamma):
    # Rationalized form preserves accuracy at large gamma.
    root = math.sqrt(gamma / (1 + gamma))
    return 1 / (2 * (1 + gamma) * (1 + root))


def reference_rows():
    rows = []
    for modulation in ("BPSK", "QPSK", "16QAM"):
        for db in (-4, 0, 4, 8, 12, 16, 20):
            gamma = 10 ** (db / 10)
            integral = rayleigh_integral(modulation, gamma)
            rows.append({"modulation": modulation, "ebN0Db": db, "awgnBer": awgn_ber(modulation, gamma),
                         "rayleighIdealBer": integral,
                         "rayleighClosedBer": rayleigh_closed(gamma) if modulation != "16QAM" else None})
    return {"referenceVersion": "channel-reference-python-v1", "energy": "data Eb=1, CN noise variance N0=1/gamma",
            "method": "Gaussian decision-region erfc; independent exponential-power adaptive quadrature",
            "lsBlockMse": "N0 / (P * Ep)", "iidPilotConstantEstimateDataMse": "1 + (1 + N0/Ep)/P",
            "oracleZfMeanSquaredEvm": "infinite for untruncated Rayleigh; finite sample values remain reportable",
            "rows": rows}


def self_test():
    for db in (-12, -4, 0, 8, 20, 40):
        gamma = 10 ** (db / 10)
        assert abs(rayleigh_integral("BPSK", gamma) - rayleigh_closed(gamma)) < 2e-11
        assert abs(rayleigh_integral("QPSK", gamma) - rayleigh_closed(gamma)) < 2e-11
    assert awgn_ber("16QAM", 0) == 0.5
    assert 0 < awgn_ber("16QAM", 1) < 0.5
    assert awgn_ber("16QAM", 100) < awgn_ber("16QAM", 1)
    return {"ok": True, "checks": "closed-form/quadrature equality, 16QAM limits and monotonicity"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    print(json.dumps(self_test() if args.self_test else reference_rows(), indent=2, allow_nan=False))
