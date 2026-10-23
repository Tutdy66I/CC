import { expect, test, type Page } from '@playwright/test'
import {
  defaultGuidedPlan,
  runGuidedExperiment,
  type GuidedRecord,
} from '../src/lib/guidedExperiment.js'
import type { CloudRecord, LocalExperiment } from '../src/lib/experimentSync.js'

const host = 'https://signallab-test.supabase.co'
const storageKey = `signallab-auth:${host}|/CC/`
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const plan = { ...defaultGuidedPlan('qam'), dbValues: [4] }
const guest: GuidedRecord = {
  version: 1,
  id: 'legacy-run',
  completedAt: '2026-10-23T00:00:00.000Z',
  plan,
  rows: runGuidedExperiment(plan, () => {}),
  analysis: 'guest analysis',
}

function session(id = owner) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(
    JSON.stringify({
      sub: id,
      exp: expires,
      aud: 'authenticated',
      role: 'authenticated',
    }),
  ).toString('base64url')
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: 'fixture-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expires,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${id.slice(0, 2)}@fixture.invalid`,
      app_metadata: {},
      user_metadata: {},
      created_at: guest.completedAt,
    },
  }
}

function cloudRecord(record = guest): CloudRecord {
  return {
    user_id: owner,
    id: record.id,
    experiment_type: 'guided',
    template: record.plan.template,
    schema_version: 1,
    engine_version: 'legacy-unknown',
    parameters: record.plan,
    results: record.rows,
    analysis: record.analysis,
    completed_at: record.completedAt,
    created_at: record.completedAt,
    updated_at: record.completedAt,
    revision: 1,
    deleted_at: null,
  }
}

async function fixture(page: Page, signedIn = true) {
  const service = {
    rows: [] as CloudRecord[],
    reject: false,
    loseResponse: false,
    tokenExchanges: 0,
    writes: 0,
    throttle: false,
    writeTimes: [] as number[],
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4177') {
      const response = await route.fetch()
      return route.fulfill({
        response,
        headers: { ...response.headers(), 'Cache-Control': 'no-store' },
      })
    }
    if (url.origin !== host) return route.abort()
    const cors = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4177',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Expose-Headers': 'Retry-After',
    }
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    if (url.pathname.endsWith('/token')) {
      service.tokenExchanges++
      return route.fulfill({ headers: cors, json: session() })
    }
    if (url.pathname.endsWith('/logout'))
      return route.fulfill({ status: 204, headers: cors })
    if (url.pathname.endsWith('/authorize'))
      return route.fulfill({
        headers: cors,
        body: 'Synthetic OAuth navigation; no real GitHub login.',
      })
    if (!url.pathname.endsWith('/experiment_records')) return route.abort()
    const request = route.request()
    const filter = (name: string) => url.searchParams.get(name)?.slice(3)
    const authorization = request.headers().authorization ?? ''
    const subject = JSON.parse(
      Buffer.from(authorization.split('.')[1], 'base64url').toString(),
    ).sub as string
    let rows = service.rows.filter((r) => r.user_id === subject)
    if (filter('id'))
      rows = rows.filter((r) =>
        url.searchParams.get('id')!.startsWith('gt.')
          ? r.id > filter('id')!
          : r.id === filter('id'),
      )
    if (request.method() === 'POST') {
      service.writes++
      service.writeTimes.push(Date.now())
      if (service.throttle)
        return route.fulfill({
          status: 429,
          headers: { ...cors, 'Retry-After': '2' },
          json: { code: 'rate_limit' },
        })
      if (service.reject)
        return route.fulfill({
          status: 403,
          headers: cors,
          json: { code: '42501' },
        })
      const body = request.postDataJSON() as CloudRecord
      if (body.user_id !== subject)
        return route.fulfill({
          status: 403,
          headers: cors,
          json: { code: '42501' },
        })
      if (service.rows.some((r) => r.user_id === subject && r.id === body.id))
        return route.fulfill({
          status: 409,
          headers: cors,
          json: { code: '23505' },
        })
      const row = {
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        revision: 1,
        deleted_at: null,
      }
      service.rows.push(row)
      if (service.loseResponse) {
        service.loseResponse = false
        return route.abort()
      }
      return route.fulfill({
        status: 201,
        headers: cors,
        json: request.headers().accept?.includes('vnd.pgrst.object')
          ? row
          : [row],
      })
    }
    if (request.method() === 'PATCH') {
      service.writes++
      const row = rows.find(
        (r) => r.revision === Number(filter('revision')) && !r.deleted_at,
      )
      if (row)
        Object.assign(row, request.postDataJSON(), {
          revision: row.revision + 1,
          updated_at: new Date().toISOString(),
        })
      if (request.headers().accept?.includes('vnd.pgrst.object')) {
        return row
          ? route.fulfill({ headers: cors, json: row })
          : route.fulfill({
              status: 406,
              headers: cors,
              json: {
                code: 'PGRST116',
                details: 'The result contains 0 rows',
                message: 'Cannot coerce the result to a single JSON object',
              },
            })
      }
      return route.fulfill({ headers: cors, json: row ? [row] : [] })
    }
    return route.fulfill({
      headers: cors,
      json: rows.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100),
    })
  })
  if (signedIn)
    await page.addInitScript(
      ({ key, data }) => {
        if (!localStorage.getItem('fixture-initialized')) {
          localStorage.setItem(key, JSON.stringify(data))
          localStorage.setItem('fixture-initialized', '1')
        }
      },
      { key: storageKey, data: session() },
    )
  return service
}

const section = (page: Page) =>
  page.getByRole('region', { name: 'AI 引导式实验', exact: true })

test('guest import requires explicit action, is idempotent and preserves the original history', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.addInitScript(
    (record) =>
      localStorage.setItem('signallab-guided-v1', JSON.stringify([record])),
    guest,
  )
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await expect(section(page).locator('#guided-history option')).toHaveText([
    '尚无完成记录',
  ])
  expect(service.rows).toHaveLength(0)
  await page.getByRole('button', { name: '将游客历史导入此账号' }).click()
  await expect.poll(() => service.rows.length).toBe(1)
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  await page.getByRole('button', { name: '将游客历史导入此账号' }).click()
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  expect(service.rows).toHaveLength(1)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('signallab-guided-v1')!),
    ),
  ).toHaveLength(1)
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('未登录，实验仍在本地运行。')).toBeVisible()
  await expect(section(page).locator('#guided-history option')).toHaveCount(1)
})

test('more than five offline completions survive reload and upload after recovery; Pages AI stays disabled', async ({
  page,
}) => {
  const service = await fixture(page)
  service.reject = true
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await section(page)
      .getByLabel('引导基础种子', { exact: true })
      .fill(String(i))
    await section(page)
      .getByRole('button', { name: '确认方案并运行', exact: true })
      .click()
    await expect(section(page).locator('#guided-history option')).toHaveCount(
      i + 1,
    )
  }
  await page.reload()
  await expect(section(page).locator('#guided-history option')).toHaveCount(6)
  service.reject = false
  await page.getByRole('button', { name: '刷新云端记录' }).click()
  await expect.poll(() => service.rows.length).toBe(6)
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  await expect(
    section(page).getByRole('button', { name: 'AI 建议参数', exact: true }),
  ).toBeDisabled()
  await expect(
    section(page).getByRole('button', { name: 'AI 分析本次结果', exact: true }),
  ).toBeDisabled()
})

test('lost insert response is retried without duplicates and another device restores the snapshot', async ({
  page,
  browser,
}) => {
  const service = await fixture(page)
  service.loseResponse = true
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await section(page)
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect.poll(() => service.rows.length).toBe(1)
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  expect(service.rows).toHaveLength(1)
  expect(service.writes).toBeGreaterThanOrEqual(2)
  const context = await browser.newContext()
  try {
    const device = await context.newPage()
    const second = await fixture(device)
    second.rows = structuredClone(service.rows)
    await device.goto('http://127.0.0.1:4177/CC/#/signallab')
    await expect(section(device).locator('tbody tr')).toHaveCount(6)
    await expect(
      section(device).getByText(/以下数据来自该完成记录/),
    ).toContainText(service.rows[0].id)
  } finally {
    await context.close()
  }
})

test('analysis conflict preserves both versions; deletion propagates and account switch cannot leak rows', async ({
  page,
}) => {
  const service = await fixture(page)
  service.rows = [cloudRecord()]
  await page.goto('./#/signallab')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  // Simulate a genuine offline edit to the persisted queue, without fabricating measurements.
  await page.evaluate(
    async ({ namespace, user }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(namespace)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('experiments', 'readwrite')
        const store = tx.objectStore('experiments')
        const get = store.get([user, 'legacy-run'])
        get.onsuccess = () => {
          const entry = get.result as LocalExperiment
          entry.record.analysis = 'offline local analysis'
          entry.pending = true
          entry.token = crypto.randomUUID()
          store.put(entry)
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
      db.close()
    },
    { namespace: `signallab-cloud-v1:${host}|/CC/`, user: owner },
  )
  service.rows[0].analysis = 'other device analysis'
  service.rows[0].revision = 2
  await page.reload()
  await expect(page.getByText('本机分析：offline local analysis')).toBeVisible()
  await expect(page.getByText('云端分析：other device analysis')).toBeVisible()
  await page.getByRole('button', { name: '保留本机分析' }).click()
  await expect
    .poll(() => service.rows[0].analysis)
    .toBe('offline local analysis')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  await page.getByRole('button', { name: '删除此云端记录' }).click()
  await expect.poll(() => service.rows[0].deleted_at).not.toBeNull()
  await page.reload()
  await expect(section(page).locator('#guided-history option')).toHaveText([
    '尚无完成记录',
  ])
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.evaluate(
    ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
    { key: storageKey, data: session(other) },
  )
  await page.reload()
  await expect(page.getByText('已登录：22@fixture.invalid')).toBeVisible()
  await expect(section(page).locator('#guided-history option')).toHaveText([
    '尚无完成记录',
  ])
})

test('GitHub OAuth uses PKCE and the existing Pages entry URL', async ({
  page,
}) => {
  await fixture(page, false)
  await page.goto('./#/signallab')
  await page.getByRole('button', { name: 'GitHub 登录' }).click()
  await page.waitForURL(`${host}/auth/v1/authorize?**`)
  const url = new URL(page.url())
  expect(url.searchParams.get('provider')).toBe('github')
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4177/CC/')
  expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe(
    's256',
  )
  expect(url.searchParams.get('code_challenge')).toBeTruthy()
})

test('PKCE callback exchanges only once, removes code and restores hash route', async ({
  page,
}) => {
  const service = await fixture(page, false)
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        `${key}-code-verifier`,
        JSON.stringify('synthetic-verifier'),
      ),
    storageKey,
  )
  await page.goto('./?code=synthetic-code')
  await expect(page).toHaveURL(/\/CC\/#\/signallab$/)
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  expect(service.tokenExchanges).toBe(1)
})

test('rate-limit retry respects Retry-After and retains the completed result', async ({
  page,
}) => {
  const service = await fixture(page)
  service.throttle = true
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await section(page)
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect.poll(() => service.writes).toBe(1)
  service.throttle = false
  await expect.poll(() => service.rows.length).toBe(1)
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  expect(service.writeTimes[1] - service.writeTimes[0]).toBeGreaterThanOrEqual(
    1800,
  )
  await expect(section(page).locator('tbody tr')).toHaveCount(6)
})

test('corrupt guest entries are reported and preserved instead of silently uploaded', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.addInitScript(
    (record) =>
      localStorage.setItem(
        'signallab-guided-v1',
        JSON.stringify([record, { id: 'broken' }]),
      ),
    guest,
  )
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '将游客历史导入此账号' }).click()
  await expect.poll(() => service.rows.length).toBe(1)
  await expect(page.getByText(/跳过 1 条格式或统计不一致/)).toBeVisible()
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('signallab-guided-v1')!),
    ),
  ).toHaveLength(2)
})

test('unavailable IndexedDB keeps the real completed result exportable without claiming persistence', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', {
      configurable: true,
      value: () => {
        throw new DOMException('test storage blocked', 'QuotaExceededError')
      },
    })
  })
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await section(page)
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section(page).locator('tbody tr')).toHaveCount(6)
  await expect(page.getByText(/本次结果尚未持久化，请导出 JSON/)).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出实验记录 JSON' }).click()
  expect((await downloaded).suggestedFilename()).toMatch(/^SignalLab-guided-/)
  expect(service.rows).toHaveLength(0)
})
