-- Private accounting, initialized under a write lock so existing rows are retained.
lock table public.experiment_records in share row exclusive mode;
create table signallab_private.experiment_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  record_count bigint not null check (record_count >= 0),
  payload_bytes bigint not null check (payload_bytes >= 0)
);
alter table signallab_private.experiment_usage enable row level security;
revoke all on table signallab_private.experiment_usage from public, anon, authenticated;

insert into signallab_private.experiment_usage
select user_id, count(*), sum(octet_length(parameters::text) + octet_length(results::text) + octet_length(analysis))
from public.experiment_records group by user_id;

-- SECURITY DEFINER is confined to private accounting: no RPC, no caller parameters,
-- no reads/writes of another owner's experiments. Original RLS/column grants run first.
-- Atomic UPDATE/UPSERT locks the owner's counter and rechecks the predicate after wait;
-- unlike SELECT COUNT after an advisory lock, it is safe with concurrent snapshots.
create function signallab_private.account_experiment_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  byte_delta bigint;
begin
  owner_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if auth.uid() is not null and auth.uid() <> owner_id then
    raise exception 'Experiment ownership mismatch' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- Only an administrator/Auth cascade can physically delete; clients cannot.
    update signallab_private.experiment_usage set
      record_count = record_count - 1,
      payload_bytes = payload_bytes - (octet_length(old.parameters::text) + octet_length(old.results::text) + octet_length(old.analysis))
    where user_id = owner_id;
    return old;
  end if;
  byte_delta := octet_length(new.parameters::text) + octet_length(new.results::text) + octet_length(new.analysis);
  if tg_op = 'INSERT' then
    insert into signallab_private.experiment_usage as usage (user_id, record_count, payload_bytes)
    values (owner_id, 1, byte_delta)
    on conflict (user_id) do update set
      record_count = usage.record_count + 1,
      payload_bytes = usage.payload_bytes + excluded.payload_bytes
    where usage.record_count < 1000
      and usage.payload_bytes + excluded.payload_bytes <= 20971520;
  else
    byte_delta := byte_delta - (octet_length(old.parameters::text) + octet_length(old.results::text) + octet_length(old.analysis));
    update signallab_private.experiment_usage set payload_bytes = payload_bytes + byte_delta
    where user_id = owner_id
      and (byte_delta <= 0 or payload_bytes + byte_delta <= 20971520);
  end if;
  if not found then
    raise exception 'SIGNALLAB_QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function signallab_private.account_experiment_record() from public, anon, authenticated;
create trigger account_experiment_record after insert or update or delete on public.experiment_records
for each row execute function signallab_private.account_experiment_record();
