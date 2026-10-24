# SignalLab v0.9.1: known-truth carrier compensation

User approved implementation, verification and publication of this design.
Baseline: a19a6fcdc700d2b320d97a2b82c82cb5cea87982.

- Compare the same received sample r=s*exp(j*theta)+w with r*exp(-j*theta).
- theta=phi+2*pi*epsilon\*n uses true parameters and absolute zero-based symbol time.
- Rotate the entire noisy sample; do not regenerate noise or substitute clean symbols.
- Reuse v0.9's mapping, PRNG order, seed schedule, slicers, work bounds and previews.
- Add an optional sample observer to the v0.9 kernel; no observer changes v0.9 outputs.
- Uncompensated conditional BER predictions remain v0.9 values. Compensated BER
  uses coherent AWGN theory (circular noise); noiseless predicted BER is zero.
- Both EVM values use original reference energy. The theoretical reference is
  sqrt(E[EVM^2]), not E[EVM]. After: sqrt(2*Ns*sigma^2/sum|s|^2).
  Before adds sum|s*(exp(j*theta)-1)|^2 to expected error energy.
- Compare paired trials; do not require individual noisy runs to improve monotonically.
- Zero offsets: exact counts and metrics agree; noiseless inverse: BER=0, EVM<1e-12.
- Same-seed noise energy is preserved across offsets; corrected BER need not match
  an independently generated zero-offset realization bit for bit.
- Separate engine/schema and browser key for compensation pairs, five-record history,
  frozen confirmation, cancellation/stale-message protection, JSON export and reload.
- Keep v0.8/v0.9 records and cloud queues untouched. No DB, auth, registration or AI changes.
- UI labels ideal known-truth baseline explicitly; show side-by-side constellations,
  actual/theoretical BER and EVM plus measured-minus-theoretical deviations and deltas.
- Test independent array channel, boundary seeds/angles/frequencies, finite budgets,
  record corruption, real workers, cancellation/failure, storage failure and legacy
  history; Chromium/Firefox/WebKit/mobile, cloud-enabled synthetic Pages, cloud no-write.
- Verify unit, lint, all TypeScript projects, build, browser suites, BER parity and
  formatting; independent review, push, PR/merge, CI/Pages and live numerical checks.

Non-goals: frequency estimation, PLL/Costas recovery, oversampling, new AI templates,
compensation cloud synchronization, production migrations or data/permission changes.
