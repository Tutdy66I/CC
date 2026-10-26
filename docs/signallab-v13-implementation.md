# v1.3 implementation gates

Approved on 2026-10-26 by the user's “开始”, against `signallab-v1.3-design.md`.

This delivery implements the full-training LS baseline. Comb pilots remain a second stage. The independent reference uses Python's standard library; no NumPy dependency is added. No formal Monte Carlo study or production data change is authorized.

1. P0/P1: freeze the mathematical protocol, energy ledger and random domain; independently generated direct DFT, FIR and small matrix fixtures must pass before receiver work.
2. P2: full-training LS, ideal CSI, gain-aware ZF/MMSE, retained erasures and frame statistics; verify independent formulas and identical hard decisions.
3. P3: isolated Worker, validated versioned JSON, IndexedDB CAS, prefix-only cancellation/resume, bounded previews and accessible plots.
4. P4: small fixed screening and performance measurements, old source-byte parity, existing tests, lint, TypeScript, production build and browser regression. Publish engineering evidence separately from research conclusions.

Each meaningful gate is formatted, verified and committed. Large/private output stays local. v1.2 numerical sources, databases, cloud queues, Auth and RLS stay unchanged.
