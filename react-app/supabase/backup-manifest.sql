-- Read-only. SHA-256 over concatenated row hashes, ordered by exact UTF-8 keys.
-- Compare before export, reconstructed local rows, and after export.
select count(*)::integer as count,
  encode(sha256(convert_to(coalesce(string_agg(
    encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex'), ''
    order by user_id::text collate "C", id collate "C"), ''), 'UTF8')), 'hex') as digest
from public.experiment_records r;
