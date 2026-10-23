# SignalLab approved data operations implementation

Approved design: ../specs/2026-10-23-signallab-data-operations-design.md.

1. Add PostgreSQL tests for per-owner count/byte limits, rollback and retained tombstones.
   Implement a private transactional counter trigger; retain original RLS and grants.
2. Add cloud browser regression for quota failures and manual retry; preserve pending data.
3. Add bounded, digest-checked export protocol and Windows DPAPI backup helper.
   Test corruption, incomplete export, atomic publication and full-column PGlite restoration.
4. Make an encrypted pre-migration application backup and verify local restoration.
5. Run tests, lint, typecheck, production build and browser regressions; review changes.
6. Apply approved quota migration, verify counters and RLS, commit/push/merge and follow Pages.
7. Make final encrypted backup, configure daily 20:00 Hong Kong heartbeat and document evidence.

No Auth export, public signup changes, paid model calls, production restore or record cleanup.
Unrelated working files remain untouched. A missing writing-plans skill is replaced by this plan.
