-- Manual administrative rollback, not part of automatic migration discovery.
-- Preserves experiments, original guard trigger, RLS, grants and cached client queues.
begin;
drop trigger if exists account_experiment_record on public.experiment_records;
drop function if exists signallab_private.account_experiment_record();
-- Keep private accounting for inspection; re-enabling requires recount under a write lock.
commit;
