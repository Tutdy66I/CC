# SignalLab AI v1.2: flat fading and pilot channel estimation

Approved in chat on 2026-10-25; baseline 174669f. No OFDM or backend migrations.

## Frozen scientific contract

- One complex matched-filter sample/symbol: y = h x + w; w ~ CN(0,N0), independent axes N0/2.
- Preserve legacy mappings: uniform data Eb=1; BPSK/QPSK/16QAM Es=1/2/4.
- AWGN h=1; primary Rayleigh block: one independent CN(0,1) h/frame.
- Separate iid-symbol Rayleigh diagnostic; no Doppler or correlated-fading interpretation.
- Perfect timing/carrier synchronization, no ISI, no coding or decision feedback.
- Never rescale noise by realized h or renormalize a sampled fading batch.
- Prefix P known pilots, energy Ep=Es, pilot symbols 1, 1+j, sqrt(2)+j sqrt(2).
- LS hhat=sum(conj(p)y)/sum(abs(p)^2), independent of truth/data.
- Paired raw, ideal-CSI ZF and LS-CSI ZF share each received frame.
- All-trial BER counts data bits only; common data indices n>=max(P) support cross-P pairing.
- Data-Eb basis N0=1/gamma; total-Eb basis N0=N/(N-P)/gamma with Ep=Es.
- Record nominal/actual data, pilot and total energies plus payload and overhead denominators.
- MSE uses mean absolute channel squared error; no mean of per-frame relative errors.
- EVM is data-aided RMS, actual reference energy, without fitted gain/phase.
- Rayleigh ZF ensemble mean-square EVM diverges; keep finite-sample tails and frame quantiles.
- Zero CSI has frozen slicer tie rules and unavailable EVM; no hidden epsilon or tail deletion.

## Reproducibility and statistics

- Versioned SHA256-derived 128-bit xoshiro128\*\* data/channel/noise streams per root seed/frame.
- Box-Muller paired normal draws; absolute-index virtual data/noise before pilot replacement.
- P/SNR/algorithm are excluded from shared realization keys; cross-cell correlation is explicit.
- Independent statistical unit is frame; fixed-size pointwise Hoeffding BER and paired differences.
- Fixed-seed frame bootstrap is approximate; Wilson is for frame events, never pooled fading bits.
- Numerical failures preserve reasons, nulls, denominators and all-trial worst-case BER bounds.
- Independent Python stdlib decision-region integration, Rayleigh BER and LS MSE references.
- Complete protocol freezes before computation; explicit source/executed dependency hashes.
- Resume only compatible environment/build; incomplete prefixes never become completed studies.

## Scope and delivery

- Separate pure low-level modules, simulation, research/statistics, record/store, Worker and UI.
- Independent local IndexedDB, export/import, checkpoint CAS, no cloud outbox or AI requests.
- Preserve legacy numeric implementations, history parsers, storage and v1.1 artifacts.
- Restore original v1.1 source/runtime bytes for archived-checkpoint continuation.
- Quick: QPSK N512 P16, 0/4/8/12dB, AWGN/block, 200 frames.
- Primary: 3 modulations x 7 SNR [-4,0,4,8,12,16,20] x P[4,16,64] x 2 channels, N1024 F10000.
- Overhead: QPSK/16QAM x SNR[0,8,16] x P[4,16,64] x 2 channels, total-Eb, N1024 F10000.
- Mismatch: 3 modulations x SNR[0,8,16] x P[4,16,64], iid, N1024 F10000.
- 10000 frames is a budget, not a precision guarantee; retain inconclusive outcomes.
- Browser budget 50M symbol-path evaluations; reject oversize without reducing samples.
- Targets: default <=5s median, cancel <=200ms, <=10Hz progress, main-thread handling P95<50ms.
- Kernel 32MiB old-space test is not a total-browser-memory claim; legacy timing regression <=10%.
- Verify TypeScript, tests, lint, builds, old BER parity, browser/Pages/cloud regression and independent review.
- Rollback removes new entry/modules only; retain isolated exports, no inverse server migration.
