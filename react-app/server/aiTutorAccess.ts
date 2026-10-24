import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Settings = Partial<Record<string, string>>
export class TutorAccessError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Claims narrow the accepted project; only the Auth server establishes identity. */
export async function authorizeTutor(
  authorization: string | undefined,
  settings: Settings,
  verify?: (token: string) => Promise<{ id: string } | null>,
): Promise<string> {
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192)
    throw new TutorAccessError(401, '请登录后使用 AI 助教。')
  let url: URL
  try {
    url = new URL(settings.SUPABASE_URL ?? '')
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error()
  } catch {
    throw new TutorAccessError(503, 'AI 身份验证配置不可用。')
  }
  const key = settings.SUPABASE_PUBLISHABLE_KEY
  if (!key?.startsWith('sb_publishable_') || !settings.AI_ALLOWED_USER_IDS)
    throw new TutorAccessError(503, 'AI 身份验证配置不可用。')
  const token = authorization.slice(7)
  let claims: { sub?: unknown; iss?: unknown; aud?: unknown; exp?: unknown }
  try {
    if (token.split('.').length !== 3) throw new Error()
    claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    )
    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      claims.iss !== `${url.origin}/auth/v1` ||
      !(
        claims.aud === 'authenticated' ||
        (Array.isArray(claims.aud) && claims.aud.includes('authenticated'))
      ) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000
    )
      throw new Error()
  } catch {
    throw new TutorAccessError(401, '登录凭据无效或过期，请重新登录。')
  }
  const verifier =
    verify ??
    (async (jwt: string) => {
      const client = createClient(url.origin, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              redirect: 'error',
              signal: AbortSignal.timeout(5000),
            }),
        },
      })
      const { data, error } = await client.auth.getUser(jwt)
      return error ? null : data.user
    })
  let user: { id: string } | null
  try {
    user = await verifier(token)
  } catch {
    throw new TutorAccessError(503, '身份服务暂时不可用。')
  }
  if (!user || user.id !== claims.sub)
    throw new TutorAccessError(401, '登录凭据无效或过期，请重新登录。')
  if (
    !settings.AI_ALLOWED_USER_IDS.split(',')
      .map((s) => s.trim())
      .includes(user.id)
  )
    throw new TutorAccessError(403, '当前账号未获允许使用 AI 助教。')
  return user.id
}

/** Conservative upper-bound reservations; never refund ambiguous provider failures. */
export function reserveTutorBudget(
  user: string,
  address: string,
  settings: Settings,
  now = Date.now(),
): void {
  const path = settings.AI_BUDGET_DB
  const daily = Number(settings.AI_DAILY_BUDGET_MICRO_USD)
  const charge = Number(settings.AI_MAX_REQUEST_MICRO_USD)
  if (
    !path ||
    !isAbsolute(path) ||
    !Number.isSafeInteger(daily) ||
    !Number.isSafeInteger(charge) ||
    daily < 1 ||
    charge < 1 ||
    charge > daily
  )
    throw new TutorAccessError(503, 'AI 预算配置不可用。')
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { timeout: 1000 })
    db.exec(
      'CREATE TABLE IF NOT EXISTS usage (key TEXT NOT NULL, period INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(key,period))',
    )
    db.exec('BEGIN IMMEDIATE')
    const minute = Math.floor(now / 60000),
      day = Math.floor(now / 86400000)
    const hash = (value: string) =>
      createHash('sha256').update(value).digest('hex')
    const limits: [string, number, number, number][] = [
      ['user:' + hash(user), minute, 1, 10],
      ['ip:' + hash(address), minute, 1, 30],
      ['budget', day, charge, daily],
    ]
    for (const [key, period, amount, limit] of limits) {
      const current = db
        .prepare('SELECT used FROM usage WHERE key=? AND period=?')
        .get(key, period)
      if (Number(current?.used ?? 0) > limit - amount)
        throw new TutorAccessError(
          429,
          key === 'budget'
            ? '今日 AI 预算已用完。'
            : 'AI 请求过于频繁，请稍后重试。',
        )
      db.prepare(
        'INSERT INTO usage VALUES(?,?,?) ON CONFLICT(key,period) DO UPDATE SET used=used+excluded.used',
      ).run(key, period, amount)
    }
    db.prepare(
      "DELETE FROM usage WHERE (key='budget' AND period<?) OR (key<>'budget' AND period<?)",
    ).run(day - 31, minute - 2)
    db.exec('COMMIT')
  } catch (cause) {
    try {
      db?.exec('ROLLBACK')
    } catch {
      /* Transaction may not have begun. */
    }
    if (cause instanceof TutorAccessError) throw cause
    throw new TutorAccessError(503, 'AI 预算存储不可用，未调用模型。')
  } finally {
    db?.close()
  }
}
