# v1.0 implementation plan

Approved design: ../specs/2026-10-24-signallab-v1-estimation-design.md

1. Add estimator tests: exact complex pilot reference, ambiguity, noisy fits and invalid inputs.
2. Implement truth-free estimator in pilotEstimator.ts; expose structured failure and diagnostics.
3. Add paired frame tests, implement carrierEstimation.ts with unchanged legacy primitives.
4. Add record validation tests and isolated local history; implement Worker protocol and bounded payloads.
5. Add real Worker browser tests before UI integration; verify export/reload/cancel/errors/mobile.
6. Run all unit tests, lint, TypeScript, normal/static builds, E2E/cloud/Pages and BER benchmark.
7. Run reproducible 20-seed studies and maximum-frame benchmark; save raw measurements.
8. Request independent code review, fix findings and rerun affected checks.
9. Commit formatted code, push only feature branch, verify SHA and open PR; no merge/deployment.
