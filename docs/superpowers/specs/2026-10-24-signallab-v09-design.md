# SignalLab AI v0.9: carrier offsets

Approved scope: symbol-sampled complex carrier rotation, local history and JSON export.
Baseline: master 24099992aa6abb7e2662003196b852d20e61ae60.

- Model: r[n] = s[n] exp(j (phi + 2 pi epsilon n)) + w[n], n starts at zero.
- epsilon is cycles/symbol, in [-0.5, 0.5); phase input is degrees in [-180, 180].
- One fixed Eb/N0 per run, one modulation, phase or frequency sweep, 5/10/20 trials.
- Keep existing mapping, energy, thresholds, PRNG, Box-Muller and v0.8 history intact.
- Complex BPSK retains its old I stream; Q uses seed XOR 0x9e3779b9. Its IQ EVM is
  explicitly different from legacy real-axis BPSK EVM. QPSK/16QAM retain I,Q order.
- Trial seeds use the existing ten-point SNR grid and statisticsSeed. Offset points
  share trial noise (paired comparisons). No claim of independent offset points.
- Noise is receiver-frame circular AWGN, added after rotation. No carrier correction.
- Predictions condition on the actual 64-bit cyclic sequence and per-symbol phase.
  Gaussian decision-region probabilities are weighted by Gray-code Hamming distance.
  Noise-free predictions use deterministic decisions, including exact quadrantal ties.
- EVM uses actual reference energy and includes phase error. No gain/phase correction.
- Bound average finite-frame BER using independent-noise 64-bit block Hoeffding bounds;
  blocks need not have identical means. PRNG is an approximation to that model.
- Work <= 80 million bits, <= 21 offsets, <= 131072 bits/trial. O(1) sample storage,
  except <= 128 deterministic preview symbols and bounded scalar trial results.
- Worker completion is the only path to records. Cancellation/unmount ignores stale
  callbacks. Records validate metadata, ordering, seeds, counts and numeric consistency.
- Separate carrier-offset-v1 schema/engine and browser key. Unknown versions are
  rejected visibly and never overwritten automatically. No cloud pending writes.
- Old account sync, quotas, backup and AI templates remain unchanged. No production
  database, permission, registration, paid AI or remote-data changes.

Acceptance: legacy parity, independent geometry/array/probability fixtures, numerical
and input boundaries, fixed-seed repeatability, record corruption/version tests,
real-worker Chromium/Firefox/WebKit/mobile and Pages regression, cloud no-write test,
unit/lint/typecheck/build, BER benchmark, formatting and independent review.

Non-goals: pulse shaping, oversampling, ISI, frequency estimation, PLL/Costas loop,
new AI templates or cloud schema migration. Future work requires a separate review.
