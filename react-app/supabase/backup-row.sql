-- Read-only. Replace :row_index and :part_index with validated nonnegative integers.
-- One row, at most 2,000 characters per part; never return the entire unbounded table.
with row_data as (
  select to_jsonb(r)::text as body
  from public.experiment_records r
  order by user_id::text collate "C", id collate "C"
  offset :row_index limit 1
)
select char_length(body) as characters,
  encode(sha256(convert_to(body, 'UTF8')), 'hex') as digest,
  substring(body from (1 + :part_index * 2000) for 2000) as part
from row_data;
