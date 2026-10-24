# SignalLab audit remediation

Approved by the user after the 2026-10-24 read-only audit of fe95a2b.

1. Sync: preserve monotonically increasing server revisions and terminal confirmed
   tombstones, including late acknowledgements. Quarantine invalid rows per sync,
   continue reconciliation, and offer account-scoped raw diagnostic export.
2. Research: validate only the new trial on each Worker message, preserve final
   full validation and deterministic results. Add mobile section navigation,
   visible auth failures, route titles and accurate product/engine labels.
3. AI: authenticated requests by default, bounded provider response reads,
   atomic shared rate and conservative persistent spending reservations. Missing
   configuration or storage rejects calls. Keep Pages AI disabled. Local-only
   development requires explicit loopback mode. Never log tokens or prompts.

Use existing browser/cloud fixtures and new behavioral regressions before fixes.
Run core tests, cloud and browser suites, lint, typecheck, production/Pages build,
and BER parity before delivery. Preserve unrelated work and publish only scoped
commits. No real model billing or production experiment writes for tests.

Real two-account JWT, second-device and disaster-recovery acceptance require
test identities/environment and remain distinct from synthetic test results.
Provider hard budgets and GitHub rules require live configuration readback.
