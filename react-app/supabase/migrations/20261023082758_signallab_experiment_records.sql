-- Additive migration. No model credentials, profiles, or privileged client RPCs.
create schema if not exists signallab_private;
revoke all on schema signallab_private from public, anon, authenticated;

create table public.experiment_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  experiment_type text not null check (experiment_type = 'guided'),
  template text not null check (template in ('equivalence', 'qam', 'sampling')),
  schema_version integer not null check (schema_version = 1),
  engine_version text not null check (char_length(engine_version) between 1 and 100),
  parameters jsonb not null check (
    jsonb_typeof(parameters) = 'object'
    and parameters ?& array['template', 'bits', 'seed', 'trials', 'dbValues', 'rationale']
    and parameters->>'template' = template
    and parameters->'bits' in ('16384'::jsonb, '65536'::jsonb, '131072'::jsonb)
    and parameters->'trials' in ('5'::jsonb, '10'::jsonb, '20'::jsonb)
    and jsonb_typeof(parameters->'seed') = 'number'
    and jsonb_typeof(parameters->'dbValues') = 'array'
    and jsonb_typeof(parameters->'rationale') = 'string'
    and char_length(parameters->>'rationale') between 1 and 2000
  ),
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  analysis text not null default '' check (char_length(analysis) <= 12000),
  completed_at timestamptz not null check (isfinite(completed_at)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  deleted_at timestamptz,
  primary key (user_id, id),
  check (octet_length(parameters::text) + octet_length(results::text) + octet_length(analysis) <= 131072)
);

create index experiment_records_completed on public.experiment_records (user_id, completed_at desc, id);
create index experiment_records_updated on public.experiment_records (user_id, updated_at, id);

create function signallab_private.guard_experiment_record()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  point jsonb;
  prior_db numeric := -6;
  seed_value numeric;
begin
  if tg_op = 'INSERT' then
    seed_value := (new.parameters->>'seed')::numeric;
    if seed_value < 0 or seed_value > 4294967295 or seed_value <> trunc(seed_value) then
      raise exception 'Invalid seed' using errcode = '23514';
    end if;
    if jsonb_array_length(new.parameters->'dbValues') not between 1 and 10
      or jsonb_array_length(new.results) not between 1 and 20 then
      raise exception 'Invalid experiment size' using errcode = '23514';
    end if;
    for point in select value from jsonb_array_elements(new.parameters->'dbValues') loop
      if point not in ('-4'::jsonb, '-2'::jsonb, '0'::jsonb, '2'::jsonb, '4'::jsonb,
        '6'::jsonb, '8'::jsonb, '10'::jsonb, '12'::jsonb, '14'::jsonb)
        or point::text::numeric <= prior_db then
        raise exception 'Invalid SNR grid' using errcode = '23514';
      end if;
      prior_db := point::text::numeric;
    end loop;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    new.revision := 1;
    new.deleted_at := null;
  else
    if old.deleted_at is not null then
      raise exception 'Deleted experiment is immutable' using errcode = '23514';
    end if;
    if row(new.user_id, new.id, new.experiment_type, new.template, new.schema_version,
      new.engine_version, new.parameters, new.results, new.completed_at, new.created_at)
      is distinct from
      row(old.user_id, old.id, old.experiment_type, old.template, old.schema_version,
      old.engine_version, old.parameters, old.results, old.completed_at, old.created_at) then
      raise exception 'Experiment snapshot is immutable' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
    if new.deleted_at is not null then new.deleted_at := new.updated_at; end if;
  end if;
  return new;
end;
$$;

revoke all on function signallab_private.guard_experiment_record() from public, anon, authenticated;
create trigger guard_experiment_record before insert or update on public.experiment_records
for each row execute function signallab_private.guard_experiment_record();

alter table public.experiment_records enable row level security;
alter table public.experiment_records force row level security;
revoke all on table public.experiment_records from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.experiment_records to authenticated;
grant insert (user_id, id, experiment_type, template, schema_version, engine_version,
  parameters, results, analysis, completed_at) on public.experiment_records to authenticated;
grant update (analysis, deleted_at) on public.experiment_records to authenticated;

create policy experiment_select_own on public.experiment_records
for select to authenticated using ((select auth.uid()) = user_id);
create policy experiment_insert_own on public.experiment_records
for insert to authenticated with check (
  (select auth.uid()) = user_id and deleted_at is null and revision = 1
);
create policy experiment_update_own on public.experiment_records
for update to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id);
-- No DELETE privilege/policy: tombstones must remain available to offline devices.
