import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

test('database owner quotas preserve isolation, tombstones and transactional accounting', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values ('${A}'), ('${B}');
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;
    `)
    for (const file of (await readdir('supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
    const asUser = async (id: string) => {
      await db.exec('reset role; set role authenticated')
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ])
    }
    const insert = (id: string) =>
      db.query(
        `insert into public.experiment_records
      (id,experiment_type,template,schema_version,engine_version,parameters,results,completed_at)
      values ($1,'guided','qam',1,'v1',
      '{"template":"qam","bits":16384,"seed":42,"trials":5,"dbValues":[0],"rationale":"test"}',
      '[{}]',now())`,
        [id],
      )
    await asUser(A)
    await insert('first')
    await db.exec('reset role')
    const accounting = await db.query<{
      equal: boolean
    }>(`select u.record_count=count(r.*)
      and u.payload_bytes=sum(octet_length(r.parameters::text)+octet_length(r.results::text)+octet_length(r.analysis)) as equal
      from signallab_private.experiment_usage u join public.experiment_records r using(user_id)
      group by u.user_id,u.record_count,u.payload_bytes`)
    assert.equal(accounting.rows[0].equal, true)
    // Admin-only fixtures exercise exact boundaries without creating 1,000 large rows.
    await db.query(
      'update signallab_private.experiment_usage set record_count=1000 where user_id=$1',
      [A],
    )
    await asUser(A)
    await assert.rejects(insert('too-many'), /SIGNALLAB_QUOTA_EXCEEDED/)
    await db.exec(
      "update public.experiment_records set deleted_at=now() where id='first'",
    )
    await assert.rejects(
      insert('tombstone-still-counts'),
      /SIGNALLAB_QUOTA_EXCEEDED/,
    )
    await assert.rejects(
      db.exec('select * from signallab_private.experiment_usage'),
      /permission denied/,
    )
    await asUser(B)
    await insert('other-account')
    await db.exec('reset role')
    await db.query(
      'update signallab_private.experiment_usage set record_count=1,payload_bytes=20971520 where user_id=$1',
      [B],
    )
    await asUser(B)
    await assert.rejects(
      db.exec(
        "update public.experiment_records set analysis='more' where id='other-account'",
      ),
      /SIGNALLAB_QUOTA_EXCEEDED/,
    )
    await assert.rejects(insert('too-large'), /SIGNALLAB_QUOTA_EXCEEDED/)
    await db.exec(
      "update public.experiment_records set deleted_at=now() where id='other-account'",
    )
    await db.exec('reset role')
    const usage = await db.query<{
      record_count: number
      payload_bytes: number
    }>(
      'select record_count,payload_bytes from signallab_private.experiment_usage where user_id=$1',
      [B],
    )
    assert.equal(Number(usage.rows[0].record_count), 1)
    assert.equal(Number(usage.rows[0].payload_bytes), 20971520)
    await db.query(
      'update signallab_private.experiment_usage set record_count=999,payload_bytes=0 where user_id=$1',
      [A],
    )
    await asUser(A)
    await db.exec('begin')
    await insert('last-slot')
    await assert.rejects(insert('over-slot'), /SIGNALLAB_QUOTA_EXCEEDED/)
    await db.exec('rollback')
    await insert('last-slot-after-rollback')
    await assert.rejects(insert('over-slot-again'), /SIGNALLAB_QUOTA_EXCEEDED/)
    assert.equal(
      (
        await db.query(
          "select * from public.experiment_records where id='last-slot'",
        )
      ).rows.length,
      0,
    )
    await db.exec('reset role')
    await db.exec(`update signallab_private.experiment_usage u set
      record_count=(select count(*) from public.experiment_records r where r.user_id=u.user_id),
      payload_bytes=(select sum(octet_length(parameters::text)+octet_length(results::text)+octet_length(analysis)) from public.experiment_records r where r.user_id=u.user_id)`)
    await asUser(A)
    await db.exec(`insert into public.experiment_records
      (id,experiment_type,template,schema_version,engine_version,parameters,results,completed_at)
      select 'bulk-'||n,'guided','qam',1,'v1',
      '{"template":"qam","bits":16384,"seed":42,"trials":5,"dbValues":[0],"rationale":"test"}',
      '[{}]',now() from generate_series(1,998) n`)
    await assert.rejects(insert('real-1001st'), /SIGNALLAB_QUOTA_EXCEEDED/)
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::integer as n from public.experiment_records',
        )
      ).rows[0].n,
      1000,
    )
  } finally {
    await db.close()
  }
})
