# v1.1 implementation plan

Approved research design: ../specs/2026-10-24-signallab-v11-research-design.md

1. Test pilot layouts, gcd ambiguity, generalized OLS and complex pilot search against independent complex/SSE references.
2. Implement a bounded search with explicit resolution/operations; retain the v1.0 estimator unchanged.
3. Test absolute-index paired frames, common-data metrics, oracle labels and calibration/evaluation seed separation.
4. Implement deterministic research trials, frozen detector calibration, complete-run statistics and resumable checkpoints.
5. Test and implement isolated record validation, Worker cancellation/resume and responsive research UI.
6. Run the preregistered screening and 200-seed confirmation studies offline; retain every trial and negative result.
7. Run unit/HTTP/backup tests, typecheck, lint, normal/static builds, browser/cloud/Pages regressions and old BER performance parity.
8. Independently review the final diff, repair findings, push the feature branch and create a PR. No automatic merge/deployment.
