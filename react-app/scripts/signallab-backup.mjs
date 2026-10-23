// Local application backup only. Never connects to a database or accepts credentials.
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  readdir,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { PGlite } from '@electric-sql/pglite'

const columns = [
  'user_id',
  'id',
  'experiment_type',
  'template',
  'schema_version',
  'engine_version',
  'parameters',
  'results',
  'analysis',
  'completed_at',
  'created_at',
  'updated_at',
  'revision',
  'deleted_at',
].sort()
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex')
export function manifestFor(rows) {
  return {
    count: rows.length,
    digest: digest(rows.map((row) => digest(row)).join('')),
  }
}
export function validateExport(snapshot) {
  if (
    snapshot.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(snapshot.commit) ||
    !snapshot.project ||
    !Array.isArray(snapshot.rows) ||
    !Array.isArray(snapshot.migrations) ||
    !snapshot.migrations.length
  )
    throw new Error('Invalid backup metadata')
  if (
    snapshot.rows.length > 100000 ||
    Buffer.byteLength(JSON.stringify(snapshot)) > 256 * 1024 * 1024
  )
    throw new Error(
      'Backup size safety limit; use a reviewed larger export protocol',
    )
  const seen = new Set()
  let prior = ''
  for (const raw of snapshot.rows) {
    const row = JSON.parse(raw)
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns))
      throw new Error('Unexpected backup column')
    const key = `${row.user_id}:${row.id}`
    if (seen.has(key)) throw new Error('duplicate backup row')
    if (Buffer.compare(Buffer.from(key), Buffer.from(prior)) < 0)
      throw new Error('Unordered backup rows')
    if (!/^[a-f0-9-]{36}$/.test(row.user_id) || typeof row.id !== 'string')
      throw new Error('Invalid owner/id')
    seen.add(key)
    prior = key
  }
  const actual = manifestFor(snapshot.rows)
  for (const manifest of [snapshot.before, snapshot.after])
    if (
      !manifest ||
      Number(manifest.count) !== actual.count ||
      manifest.digest !== actual.digest
    )
      throw new Error(
        'Backup manifest mismatch: source changed or export incomplete',
      )
  return snapshot
}

export function dpapi(mode, input) {
  if (process.platform !== 'win32' || !['protect', 'unprotect'].includes(mode))
    throw new Error('Windows CurrentUser DPAPI is required')
  const method = mode === 'protect' ? 'Protect' : 'Unprotect'
  const command = `Add-Type -AssemblyName System.Security; $ErrorActionPreference='Stop'; try { $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r)) } catch { [Console]::Error.Write('DPAPI operation failed'); exit 1 }`
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const output = []
    child.stdout.on('data', (part) => output.push(part))
    child.stderr.resume()
    child.on('error', () => reject(new Error('DPAPI process unavailable')))
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.from(Buffer.concat(output).toString(), 'base64'))
        : reject(new Error('DPAPI operation failed')),
    )
    child.stdin.on('error', () => {})
    child.stdin.end(input.toString('base64'))
  })
}

export async function restoreCheck(snapshot) {
  validateExport(snapshot)
  const db = new PGlite()
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      grant usage on schema auth to authenticated;`)
    // Trusted, versioned local schema only. This function has no remote connector.
    for (const migration of snapshot.migrations) await db.exec(migration.sql)
    await db.exec('alter table public.experiment_records disable trigger user')
    for (const raw of snapshot.rows) {
      const row = JSON.parse(raw)
      await db.query(
        'insert into auth.users values ($1) on conflict do nothing',
        [row.user_id],
      )
      await db.query(
        `insert into public.experiment_records select * from jsonb_populate_record(null::public.experiment_records,$1::jsonb)`,
        [raw],
      )
    }
    await db.exec('alter table public.experiment_records enable trigger user')
    // Compare JSONB in PostgreSQL: timestamps retain microsecond precision, key order is immaterial.
    for (const raw of snapshot.rows) {
      const row = JSON.parse(raw)
      const result = await db.query(
        `select to_jsonb(r) = to_jsonb(jsonb_populate_record(null::public.experiment_records,$3::jsonb)) as equal from public.experiment_records r where user_id=$1 and id=$2`,
        [row.user_id, row.id, raw],
      )
      if (result.rows[0]?.equal !== true)
        throw new Error('Restoration column mismatch')
    }
    const { rows } = await db.query(
      'select count(*)::integer as count from public.experiment_records',
    )
    if (rows[0].count !== snapshot.rows.length)
      throw new Error('Restoration count mismatch')
    return {
      records: rows[0].count,
      columns: columns.length,
      authRestored: false,
    }
  } finally {
    await db.close()
  }
}

export async function publishBackup(snapshot, directory, protector = dpapi) {
  validateExport(snapshot)
  await restoreCheck(snapshot)
  const plaintext = Buffer.from(JSON.stringify(snapshot))
  const encrypted = await protector('protect', plaintext)
  const envelope = {
    version: 1,
    protection: 'Windows-CurrentUser-DPAPI',
    sha256: digest(plaintext),
    ciphertext: encrypted.toString('base64'),
  }
  await mkdir(directory, { recursive: true })
  const file = path.join(
    directory,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.slbackup`,
  )
  const temporary = `${file}.partial`
  try {
    await writeFile(temporary, JSON.stringify(envelope), {
      flag: 'wx',
      mode: 0o600,
    })
    await openBackup(temporary, protector)
    await rename(temporary, file)
    return file
  } finally {
    await rm(temporary, { force: true })
  }
}
export async function openBackup(file, protector = dpapi) {
  const envelope = JSON.parse(await readFile(file, 'utf8'))
  if (
    envelope.version !== 1 ||
    envelope.protection !== 'Windows-CurrentUser-DPAPI'
  )
    throw new Error('Unknown encrypted backup format')
  const plaintext = await protector(
    'unprotect',
    Buffer.from(envelope.ciphertext, 'base64'),
  )
  if (digest(plaintext) !== envelope.sha256)
    throw new Error('Backup checksum mismatch')
  return validateExport(JSON.parse(plaintext))
}

async function cli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const directory = path.join(root, 'backups.local')
  const mode = process.argv[2]
  if (mode === 'chunk' || mode === 'seal') {
    if (!/^[a-f0-9-]{36}$/.test(process.argv[3] ?? ''))
      throw new Error('Invalid staging identifier')
  }
  const staging = path.join(directory, 'staging.local', process.argv[3] ?? '')
  if (mode === 'chunk') {
    const index = Number(process.argv[4])
    const value = process.argv[5] ?? ''
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 100000 ||
      !/^[A-Za-z0-9+/=]+$/.test(value) ||
      value.length > 8000
    )
      throw new Error('Invalid encrypted staging chunk')
    await mkdir(staging, { recursive: true })
    await writeFile(
      path.join(staging, `${String(index).padStart(6, '0')}.part`),
      await dpapi('protect', Buffer.from(value, 'base64')),
      { flag: 'wx', mode: 0o600 },
    )
    console.log('Encrypted chunk saved')
    return
  }
  if (process.argv[2] === 'verify') {
    const snapshot = await openBackup(process.argv[3])
    console.log(JSON.stringify(await restoreCheck(snapshot)))
    return
  }
  if (mode !== 'create' && mode !== 'seal')
    throw new Error('Use create (NDJSON stdin) or verify <encrypted file>')
  let snapshot
  let finished = false
  let bytes = 0
  let input
  let lines
  if (mode === 'seal') {
    const files = (await readdir(staging)).sort()
    const parts = []
    let total = 0
    for (let index = 0; index < files.length; index++) {
      if (files[index] !== `${String(index).padStart(6, '0')}.part`)
        throw new Error('Incomplete encrypted staging sequence')
      const part = await dpapi(
        'unprotect',
        await readFile(path.join(staging, files[index])),
      )
      total += part.length
      if (total > 200 * 1024 * 1024) throw new Error('Staging safety limit')
      parts.push(part)
    }
    lines = Buffer.concat(parts).toString('utf8').trimEnd().split('\n')
  } else {
    input = createInterface({ input: process.stdin, crlfDelay: Infinity })
    lines = input
  }
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 300000)
        throw new Error('Input row too large')
      const message = JSON.parse(line)
      if (message.type === 'start' && !snapshot) {
        const migrations = await Promise.all(
          (await readdir(path.join(root, 'supabase/migrations')))
            .filter((name) => message.migrations?.includes(name))
            .sort()
            .map(async (name) => ({
              name,
              sql: await readFile(
                path.join(root, 'supabase/migrations', name),
                'utf8',
              ),
            })),
        )
        if (migrations.length !== message.migrations.length)
          throw new Error('Applied migration source unavailable')
        snapshot = {
          version: 1,
          project: message.project,
          commit: message.commit,
          capturedAt: new Date().toISOString(),
          before: message.manifest,
          rows: [],
          migrations,
        }
      } else if (message.type === 'row' && snapshot) {
        bytes += Buffer.byteLength(message.value)
        if (snapshot.rows.length >= 100000 || bytes > 200 * 1024 * 1024)
          throw new Error('Export safety limit exceeded')
        snapshot.rows.push(message.value)
      } else if (message.type === 'finish' && snapshot) {
        snapshot.after = message.manifest
        const file = await publishBackup(snapshot, directory)
        console.log(
          JSON.stringify({
            file,
            records: snapshot.rows.length,
            restored: true,
            authRestored: false,
          }),
        )
        finished = true
        break
      } else throw new Error('Invalid backup input sequence')
    }
    if (!finished) throw new Error('Incomplete export; no backup published')
  } finally {
    input?.close()
    process.stdin.destroy()
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  cli().catch(() => {
    console.error(
      'SignalLab backup failed; no valid backup overwritten. Check export, local schema and DPAPI access.',
    )
    process.exitCode = 1
    process.stdin.destroy()
  })
