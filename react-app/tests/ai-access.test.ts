import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  authorizeTutor,
  reserveTutorBudget as reserveAt,
} from '../server/aiTutorAccess.js'

const reserveTutorBudget = (
  user: string,
  address: string,
  settings: Record<string, string>,
) => reserveAt(user, address, settings, 1792800000000)

const user = '11111111-1111-4111-8111-111111111111'
const config = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  AI_ALLOWED_USER_IDS: user,
}
const token = (patch = {}) =>
  'e30.' +
  Buffer.from(
    JSON.stringify({
      sub: user,
      iss: config.SUPABASE_URL + '/auth/v1',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 60,
      ...patch,
    }),
  ).toString('base64url') +
  '.fixture'

test('AI access rejects anonymous, expired, foreign project and unverified tokens before spending', async () => {
  let calls = 0
  const verify = async () => {
    calls++
    return { id: user }
  }
  for (const authorization of [
    undefined,
    'Bearer ' + token({ exp: 1 }),
    'Bearer ' + token({ iss: 'https://other.supabase.co/auth/v1' }),
  ])
    await assert.rejects(authorizeTutor(authorization, config, verify), /登录/)
  assert.equal(calls, 0)
  await assert.rejects(
    authorizeTutor('Bearer ' + token(), config, async () => null),
    /登录/,
  )
  assert.equal(await authorizeTutor('Bearer ' + token(), config, verify), user)
  await assert.rejects(
    authorizeTutor(
      'Bearer ' + token(),
      { ...config, AI_ALLOWED_USER_IDS: 'other' },
      verify,
    ),
    /允许/,
  )
})

test('budget reservations survive reconnects, share a global cap, and fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signallab-budget-'))
  const settings = {
    AI_BUDGET_DB: join(directory, 'usage.local'),
    AI_DAILY_BUDGET_MICRO_USD: '15',
    AI_MAX_REQUEST_MICRO_USD: '5',
  }
  try {
    reserveTutorBudget(user, '127.0.0.1', settings)
    reserveTutorBudget('second', '127.0.0.2', settings)
    reserveTutorBudget(user, '127.0.0.1', settings)
    assert.throws(
      () => reserveTutorBudget('third', '127.0.0.3', settings),
      /预算/,
    )
    assert.throws(() => reserveTutorBudget(user, '127.0.0.1', {}), /配置/)
    const rates = { ...settings, AI_DAILY_BUDGET_MICRO_USD: '100000' }
    for (let i = 0; i < 8; i++) reserveTutorBudget(user, '127.0.0.1', rates)
    assert.throws(() => reserveTutorBudget(user, '127.0.0.1', rates), /频繁/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('separate Node processes cannot over-reserve a shared daily budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signallab-shared-'))
  const config = {
    AI_BUDGET_DB: join(directory, 'shared.local'),
    AI_DAILY_BUDGET_MICRO_USD: '15',
    AI_MAX_REQUEST_MICRO_USD: '5',
  }
  try {
    const moduleUrl = new URL('../server/aiTutorAccess.js', import.meta.url)
      .href
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, n) =>
        promisify(execFile)(process.execPath, [
          '--input-type=module',
          '-e',
          `import { reserveTutorBudget } from ${JSON.stringify(moduleUrl)}; try { reserveTutorBudget('user-${n}','ip-${n}',${JSON.stringify(config)},1792800000000); console.log(200) } catch(e) { if(e.status !== 429) throw e; console.log(429) }`,
        ]),
      ),
    )
    assert.equal(responses.filter((r) => r.stdout.trim() === '200').length, 3)
    assert.equal(responses.filter((r) => r.stdout.trim() === '429').length, 3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
