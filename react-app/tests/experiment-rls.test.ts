import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const parameters = {
  template: 'qam',
  bits: 16384,
  seed: 42,
  trials: 5,
  dbValues: [0, 4],
  rationale: 'test',
}

test('PostgreSQL migration enforces ownership, immutable snapshots, revisions and tombstones', async (t) => {
  const db = new PGlite()
  try {
    // Only the Supabase Auth context is simulated; policies/triggers run in PostgreSQL.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${A}'), ('${B}');
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `)
    await db.exec(
      await readFile(
        'supabase/migrations/20261023082758_signallab_experiment_records.sql',
        'utf8',
      ),
    )
    const asUser = async (id: string) => {
      await db.exec('reset role; set role authenticated;')
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id,
      ])
    }
    const insert = (owner = A, id = 'run', params = parameters) =>
      db.query(
        `
      insert into public.experiment_records
      (user_id,id,experiment_type,template,schema_version,engine_version,parameters,results,completed_at)
      values ($1,$2,'guided','qam',1,'guided-awgn-v1',$3::jsonb,'[{}]'::jsonb,now()) returning *`,
        [owner, id, JSON.stringify(params)],
      )

    await t.test(
      'anonymous and unauthenticated roles have no access',
      async () => {
        await db.exec('set role anon')
        await assert.rejects(
          db.query('select * from public.experiment_records'),
          /permission denied/,
        )
        await asUser('')
        await assert.rejects(insert(), /row-level security/)
      },
    )
    await t.test('A can insert own rows; spoofing B is refused', async () => {
      await asUser(A)
      const result = await insert()
      assert.equal(result.rows.length, 1)
      await assert.rejects(insert(B, 'spoof'), /row-level security/)
    })
    await t.test(
      'B cannot see or update A even with its exact ID',
      async () => {
        await asUser(B)
        assert.equal(
          (await db.query('select * from public.experiment_records')).rows
            .length,
          0,
        )
        assert.equal(
          (
            await db.query(
              "update public.experiment_records set analysis='attack' where id='run' returning *",
            )
          ).rows.length,
          0,
        )
        await insert(B, 'run')
      },
    )
    await t.test(
      'column grants reject ownership, result and audit-field changes',
      async () => {
        await asUser(A)
        for (const assignment of [
          "user_id='22222222-2222-4222-8222-222222222222'",
          "results='[]'::jsonb",
          'revision=999',
          'created_at=now()',
        ]) {
          await assert.rejects(
            db.exec(
              `update public.experiment_records set ${assignment} where id='run'`,
            ),
            /permission denied/,
          )
        }
        await assert.rejects(
          db.query("delete from public.experiment_records where id='run'"),
          /permission denied/,
        )
      },
    )
    await t.test(
      'CAS admits one writer, generates revision and keeps the other analysis',
      async () => {
        await asUser(A)
        const first = await db.query<{ revision: number }>(
          "update public.experiment_records set analysis='first' where id='run' and revision=1 returning revision",
        )
        assert.equal(first.rows[0].revision, 2)
        assert.equal(
          (
            await db.query(
              "update public.experiment_records set analysis='stale' where id='run' and revision=1 returning *",
            )
          ).rows.length,
          0,
        )
      },
    )
    await t.test(
      'invalid plans and oversized payloads fail at database boundary',
      async () => {
        await asUser(A)
        for (const patch of [
          { seed: -1 },
          { seed: 1.5 },
          { dbValues: [4, 0] },
          { dbValues: [] },
          { bits: 99 },
        ]) {
          await assert.rejects(
            insert(A, crypto.randomUUID(), { ...parameters, ...patch }),
          )
        }
        await assert.rejects(
          db.query(
            "update public.experiment_records set analysis=$1 where id='run'",
            ['a'.repeat(12001)],
          ),
        )
      },
    )
    await t.test(
      'deletion is visible as tombstone and cannot be undone by old devices',
      async () => {
        await asUser(A)
        const deleted = await db.query<{
          revision: number
          deleted_at: string
        }>(
          "update public.experiment_records set deleted_at='2000-01-01' where id='run' and revision=2 returning revision,deleted_at",
        )
        assert.equal(deleted.rows[0].revision, 3)
        assert.ok(
          Date.parse(deleted.rows[0].deleted_at) > Date.parse('2026-01-01'),
        )
        assert.equal(
          (
            await db.query(
              "update public.experiment_records set deleted_at=null where id='run' returning *",
            )
          ).rows.length,
          0,
        )
        assert.equal(
          (
            await db.query(
              "select * from public.experiment_records where id='run'",
            )
          ).rows.length,
          1,
        )
        await assert.rejects(insert(), /duplicate key/)
      },
    )
  } finally {
    await db.close()
  }
})
