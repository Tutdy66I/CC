import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  copyFile,
} from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  digest,
  manifestFor,
  validateExport,
  publishBackup,
  openBackup,
  restoreCheck,
  dpapi,
} from '../scripts/signallab-backup.mjs'

const row = JSON.stringify({
  user_id: '11111111-1111-4111-8111-111111111111',
  id: 'test',
  experiment_type: 'guided',
  template: 'qam',
  schema_version: 1,
  engine_version: 'v1',
  parameters: {
    template: 'qam',
    bits: 16384,
    seed: 42,
    trials: 5,
    dbValues: [0],
    rationale: 'test',
  },
  results: [{}],
  analysis: '完整恢复',
  completed_at: '2026-01-01T00:00:00+00:00',
  created_at: '2026-01-01T00:00:01.123456+00:00',
  updated_at: '2026-01-02T00:00:00+00:00',
  revision: 3,
  deleted_at: '2026-01-02T00:00:00+00:00',
})
const migrations = await Promise.all(
  (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map(async (name) => ({
      name,
      sql: await readFile(`supabase/migrations/${name}`, 'utf8'),
    })),
)
const before = manifestFor([row])
const snapshot = {
  version: 1,
  project: 'test',
  commit: 'a'.repeat(40),
  capturedAt: new Date().toISOString(),
  before,
  after: before,
  rows: [row],
  migrations,
}
// Test-only reversible protector verifies atomic/validation behavior on every OS.
const protector = async (mode, input) =>
  mode === 'protect'
    ? Buffer.from(input.toString('base64'))
    : Buffer.from(input.toString(), 'base64')

test('backup detects truncation, source changes, duplicate rows and unexpected sensitive columns', () => {
  assert.throws(() => validateExport({ ...snapshot, rows: [] }), /manifest/)
  assert.throws(
    () =>
      validateExport({
        ...snapshot,
        after: { ...before, digest: '0'.repeat(64) },
      }),
    /manifest/,
  )
  assert.throws(
    () => validateExport({ ...snapshot, rows: [row, row] }),
    /duplicate|manifest/,
  )
  const unsafe = JSON.stringify({
    ...JSON.parse(row),
    access_token: 'not-a-real-token',
  })
  assert.throws(
    () =>
      validateExport({
        ...snapshot,
        rows: [unsafe],
        before: manifestFor([unsafe]),
        after: manifestFor([unsafe]),
      }),
    /column/,
  )
})

test('encrypted publication is atomic and detects tampering; temporary restoration compares every column', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'signallab-backup-'))
  try {
    const file = await publishBackup(snapshot, directory, protector)
    assert.deepEqual((await openBackup(file, protector)).rows, [row])
    assert.equal((await restoreCheck(snapshot)).records, 1)
    const original = await readFile(file)
    await assert.rejects(
      publishBackup({ ...snapshot, rows: [] }, directory, protector),
      /manifest/,
    )
    assert.deepEqual(await readFile(file), original)
    const corrupt = JSON.parse(original.toString())
    corrupt.sha256 = digest('corruption')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify(corrupt))
    await assert.rejects(openBackup(file, protector), /checksum/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test(
  'CLI rejects missing encrypted chunks and truncated exports without publishing',
  { skip: process.platform !== 'win32' },
  async () => {
    const parent = path.resolve('.test-build')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(path.join(parent, 'backup-cli-'))
    const run = promisify(execFile)
    try {
      await mkdir(path.join(directory, 'scripts'))
      await mkdir(path.join(directory, 'supabase/migrations'), {
        recursive: true,
      })
      await copyFile(
        'scripts/signallab-backup.mjs',
        path.join(directory, 'scripts/signallab-backup.mjs'),
      )
      for (const migration of migrations)
        await copyFile(
          `supabase/migrations/${migration.name}`,
          path.join(directory, 'supabase/migrations', migration.name),
        )
      const script = path.join(directory, 'scripts/signallab-backup.mjs')
      const stage = '11111111-1111-4111-8111-111111111111'
      const lines =
        [
          {
            type: 'start',
            project: 'test',
            commit: snapshot.commit,
            manifest: before,
            migrations: migrations.map((m) => m.name),
          },
          { type: 'row', value: row },
        ]
          .map((m) => JSON.stringify(m))
          .join('\n') + '\n'
      await run(
        process.execPath,
        [script, 'chunk', stage, '1', Buffer.from(lines).toString('base64')],
        { windowsHide: true },
      )
      await assert.rejects(
        run(process.execPath, [script, 'seal', stage], { windowsHide: true }),
      )
      const truncated = '22222222-2222-4222-8222-222222222222'
      await run(
        process.execPath,
        [
          script,
          'chunk',
          truncated,
          '0',
          Buffer.from(lines).toString('base64'),
        ],
        { windowsHide: true },
      )
      await assert.rejects(
        run(process.execPath, [script, 'seal', truncated], {
          windowsHide: true,
        }),
      )
      assert.equal(
        (await readdir(path.join(directory, 'backups.local'))).filter((f) =>
          f.endsWith('.slbackup'),
        ).length,
        0,
      )
      const finish = JSON.stringify({ type: 'finish', manifest: before }) + '\n'
      await run(
        process.execPath,
        [
          script,
          'chunk',
          truncated,
          '1',
          Buffer.from(finish).toString('base64'),
        ],
        { windowsHide: true },
      )
      const complete = JSON.parse(
        (
          await run(process.execPath, [script, 'seal', truncated], {
            windowsHide: true,
          })
        ).stdout,
      )
      assert.equal(complete.records, 1)
      assert.equal(complete.restored, true)
      assert.deepEqual((await openBackup(complete.file)).rows, [row])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test(
  'Windows DPAPI protects payload and rejects corrupted ciphertext',
  { skip: process.platform !== 'win32' },
  async () => {
    const input = Buffer.from('private experiment payload')
    const encrypted = await dpapi('protect', input)
    assert.notEqual(encrypted.toString(), input.toString())
    assert.deepEqual(await dpapi('unprotect', encrypted), input)
    encrypted[encrypted.length - 5] ^= 1
    await assert.rejects(dpapi('unprotect', encrypted))
  },
)
