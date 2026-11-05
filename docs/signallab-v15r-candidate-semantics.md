# v1.5 candidate semantics for independent review

Status: candidate, not a frozen protocol. The registry is descriptive and must not be interpreted as an approved protocol identity. The numerical proof method, evidence byte layout, dependency closure, and runtime are not yet approved.

## Observations, decisions and endpoints

All seven decisions use the same received capture. `raw` uses the nominal useful FFT start and no CFO correction. `estimated` uses only observation and public parameters. `ideal` uses timing and CFO truth, but neither the true channel nor true initial phase. Four truth-assisted intervention decisions are `ed`, `e0`, `0d`, and `00`, where residual CFO and timing are `(e,d)`, `(e,0)`, `(0,d)`, and `(0,0)`. The four points retain separate decision/erasure codes. Their scorer alone may access transmitted bits.

Each decision contains 768 bits. Let E be observed wrong decisions and R erased bits, with nonnegative integers E + R <= 768. L = E/768 and U = (E+R)/768. Erasures have no observed decision. Capture failure or valid-window extraction failure yields E=0, R=768; per-subcarrier equalization failure erases its affected two QPSK bits. These outcomes have distinct causes. A physically unsafe window is not necessarily a failed extraction; d=+2 is outside [-9,0]. Invalid input, malformed evidence and unexpected computation errors abort rather than become erasures.

`G = estimated - ideal`, `R = estimated - raw`, `I = ed - e0 - 0d + 00`. Here R names a comparison; it is distinct from R the erased-bit count above. Per-frame bounds for A-B are `(L_A-U_B, U_A-L_B)`; for I they are `(L_ed-U_e0-U_0d+L_00, U_ed-L_e0-L_0d+U_00)`. These are conservative bounds and need not be jointly sharp. `T_j` is the set of population means for comparison j under every admissible erased-bit completion. Its endpoints are not observed point BERs.

The twelve comparisons are S00, S10, S01, S11 in that order, each with G, R, I in that order; their 24 endpoints are the lower and upper bound of each comparison. G tests `inf T_G <= 0` against `inf T_G > 0`; R tests `sup T_R >= 0` against `sup T_R < 0`; I tests `0 in T_I` against `0 not in T_I`. With simultaneously valid bounds `[C_L,C_U]`, support G only if `C_L > 0`, R only if `C_U < 0`, and I only if `C_L > 0 or C_U < 0`. Equality and an interval crossing zero do not reject. Hoeffding/Bonferroni coverage requires the predeclared bounded independent-frame model and fixed sample size; pseudorandom domain labels do not prove independence.

## Random address

Candidate `SL15KEY3` binds phase domain, 32-byte protocol identity and 16-byte experiment identity to a run key. The `SL15RNG2` address contains domain u8, protocol identity 32 bytes, scenario identity 32 bytes, frame u64be, role u8, slot u32be and block u32be. Experiment identity is also part of the logical address through the run key. Domains 01/02/03/04 are diagnostic/exploratory/preflight/confirmatory; 7f is public test only. Roles 01/02 mean payload/noise. For the R2 candidate frame is 0..34334; payload slots are symbol\*128+active FFT-bin index; noise slots are 0..1046; block is 0. All branches within a frame use the same capture; streams are not reused across scenarios.

`SL15KEY3` changes bytes relative to the R2 direct-phase-key proposal. Its adoption, the exact numerical proof, raw evidence schema, final dependency closure and runtime remain freeze blockers. This document does not authorize generation of roots or samples.
