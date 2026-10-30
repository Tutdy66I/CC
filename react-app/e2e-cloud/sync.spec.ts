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
    quota: false,
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
      if (service.quota)
        return route.fulfill({
          status: 400,
          headers: cors,
          json: { code: 'P0001', message: 'SIGNALLAB_QUOTA_EXCEEDED' },
        })
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

async function localRecord(
  page: Page,
  id: string,
): Promise<LocalExperiment | undefined> {
  return page.evaluate(
    async ({ namespace, user, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(namespace)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<LocalExperiment | undefined>(
          (resolve, reject) => {
            const tx = db.transaction('experiments', 'readonly')
            const request = tx.objectStore('experiments').get([user, id])
            tx.oncomplete = () =>
              resolve(request.result as LocalExperiment | undefined)
            tx.onabort = () => reject(tx.error)
          },
        )
      } finally {
        db.close()
      }
    },
    { namespace: `signallab-cloud-v1:${host}|/CC/`, user: owner, id },
  )
}

test('bad cloud rows are isolated while later valid rows and tombstones reconcile', async ({
  page,
}) => {
  const service = await fixture(page)
  service.rows = [
    { ...cloudRecord(), id: 'a-bad', results: [{}] } as CloudRecord,
    { ...cloudRecord(), id: 'b-valid' },
    {
      ...cloudRecord(),
      id: 'c-deleted',
      revision: 2,
      deleted_at: guest.completedAt,
    },
  ]
  await page.goto('./#/signallab')
  await expect(section(page).locator('#guided-history option')).toHaveCount(1)
  await expect(section(page).getByText(/以下数据来自该完成记录/)).toContainText(
    'b-valid',
  )
  await expect(page.getByText(/已隔离 1 条云端记录/)).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出同步诊断 JSON' }).click()
  const { readFile } = await import('node:fs/promises')
  const diagnostics = JSON.parse(
    await readFile((await (await downloaded).path())!, 'utf8'),
  )
  expect(diagnostics.rows[0].id).toBe('a-bad')
  expect(service.writes).toBe(0)
})

test('failed OAuth callback is visible while signed out', async ({ page }) => {
  await fixture(page, false)
  await page.goto('./?error=access_denied#/signallab')
  await expect(
    page.getByLabel('实验账号与同步').getByRole('status'),
  ).toHaveText('GitHub 登录未完成，请重试。')
})

test('a delayed response in one tab cannot resurrect a tombstone saved by another tab', async ({
  page,
  context,
}) => {
  const service = await fixture(page)
  service.rows = [cloudRecord()]
  await page.goto('./#/signallab')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  const device = await context.newPage()
  const second = await fixture(device)
  second.rows = service.rows
  await device.goto('http://127.0.0.1:4177/CC/#/signallab')
  await expect(device.getByText('云端同步完成。')).toBeVisible()
  let release!: () => void, observed!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    observed = resolve
  })
  let held = false
  await page.route('**/rest/v1/experiment_records*', async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback()
    held = true
    const old = structuredClone(service.rows)
    observed()
    await gate
    await route.fulfill({
      json: old,
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4177' },
    })
  })
  try {
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await started
    await device.getByRole('button', { name: '删除此云端记录' }).click()
    await expect.poll(() => service.rows[0].deleted_at).not.toBeNull()
    await expect(section(device).locator('#guided-history option')).toHaveText([
      '尚无完成记录',
    ])
    release()
    await expect(section(page).locator('#guided-history option')).toHaveText([
      '尚无完成记录',
    ])
  } finally {
    release()
    await device.close()
  }
})

test('signed-in v1.1 research never enters the cloud upload queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  await page.reload()
  await expect(r.getByLabel('研究实验历史').locator('option')).toHaveCount(1)
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in v1.3 OFDM stays local and never enters the cloud queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const r = page.getByRole('region', {
    name: 'OFDM 与频率选择性多径',
    exact: true,
  })
  await r.getByLabel('OFDM 试验帧数').fill('8')
  await r
    .getByRole('button', { name: '冻结 OFDM 协议并运行', exact: true })
    .click()
  await expect(r.getByRole('status')).toContainText('已保存本地')
  await page.reload()
  await expect(r.getByRole('status')).toContainText('已恢复本地完整记录')
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in comb experiment uses an isolated local database with zero cloud writes', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await page.getByLabel('OFDM 实验模式').selectOption('comb')
  const r = page.getByRole('region', {
    name: 'OFDM 梳状导频与插值',
    exact: true,
  })
  await r.getByLabel('OFDM 试验帧数').fill('8')
  await r
    .getByRole('button', { name: '冻结 OFDM 协议并运行', exact: true })
    .click()
  await expect(r.getByRole('status')).toContainText('已保存本地')
  await page.reload()
  await expect(r.getByRole('status')).toContainText('已恢复本地完整记录')
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in v1.4 joint synchronization stays local and never enters the cloud queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const region = page.getByRole('region', {
    name: 'OFDM 接收同步',
    exact: true,
  })
  await region.getByLabel('同步试验帧数').fill('4')
  await region.getByRole('button', { name: '运行同步对照' }).click()
  await expect(region.getByRole('status')).toContainText('已保存本地')
  await page.reload()
  await expect(region.getByRole('status')).toContainText('已恢复本地记录')
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in v1.2 channel research persists locally without any cloud upload', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const region = page.getByRole('region', {
    name: '无线衰落与信道估计研究',
    exact: true,
  })
  await region.getByLabel('信道研究帧长').fill('128')
  await region.getByLabel('信道研究试验帧数').fill('20')
  await region.getByLabel('信道研究 Eb/N0 列表').fill('0,8')
  await region.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(region.getByRole('status')).toContainText('研究完成')
  await page.reload()
  await expect(region.getByLabel('信道研究历史').locator('option')).toHaveCount(
    1,
  )
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in pilot estimation remains local and never enters the cloud upload queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('估计实验完成')
  await page.reload()
  await expect(region.getByLabel('估计实验历史').locator('option')).toHaveCount(
    1,
  )
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in ideal compensation snapshots never enter the cloud upload queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await region.getByLabel('补偿扫描点').fill('0,60')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  await page.reload()
  await expect(region.locator('tbody tr')).toHaveCount(4)
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('signed-in carrier experiments remain local and never enter the cloud upload queue', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(
    section(page).getByText(
      '仅记录完整运行；登录记录保存在当前账号并跨设备同步。',
      { exact: false },
    ),
  ).toBeVisible()
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  await page.reload()
  await expect(region.locator('tbody tr')).toHaveCount(1)
  expect(service.writes).toBe(0)
  expect(service.rows).toEqual([])
})

test('quota pauses automatic uploads, preserves local history and permits manual retry', async ({
  page,
}) => {
  const service = await fixture(page)
  service.quota = true
  await page.addInitScript(
    (record) =>
      localStorage.setItem('signallab-guided-v1', JSON.stringify([record])),
    guest,
  )
  await page.goto('./#/signallab')
  await page.getByRole('button', { name: '将游客历史导入此账号' }).click()
  await expect(page.getByText(/云端配额已满/)).toBeVisible()
  const writes = service.writes
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
  })
  await page.waitForTimeout(1500)
  expect(service.writes).toBe(writes)
  await expect(section(page).locator('#guided-history option')).toHaveCount(1)
  service.quota = false
  await page.getByRole('button', { name: '刷新云端记录' }).click()
  await expect.poll(() => service.rows.length).toBe(1)
  await expect(page.getByText('云端同步完成。')).toBeVisible()
})

test('quota-blocked new records cannot starve an existing record tombstone', async ({
  page,
}) => {
  const service = await fixture(page)
  service.rows = [cloudRecord({ ...guest, id: 'z-existing' })]
  service.quota = true
  await page.addInitScript(
    (record) =>
      localStorage.setItem('signallab-guided-v1', JSON.stringify([record])),
    guest,
  )
  await page.goto('./#/signallab')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  await page.getByRole('button', { name: '将游客历史导入此账号' }).click()
  await expect(page.getByText(/云端配额已满/)).toBeVisible()
  await section(page).locator('#guided-history').selectOption('z-existing')
  await page.getByRole('button', { name: '删除此云端记录' }).click()
  await page.getByRole('button', { name: '刷新云端记录' }).click()
  await expect.poll(() => service.rows[0].deleted_at).not.toBeNull()
  await expect(section(page).locator('#guided-history option')).toHaveCount(1)
})

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
  await page.goto('./#/signallab')
  await expect(page.getByText('已登录：', { exact: false })).toBeVisible()
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let retryStarted = false
  await page.route('**/rest/v1/experiment_records*', async (route) => {
    if (route.request().method() === 'POST' && service.writes === 1) {
      retryStarted = true
      await gate
    }
    await route.fallback()
  })
  try {
    service.loseResponse = true
    await section(page)
      .getByRole('button', { name: '确认方案并运行', exact: true })
      .click()
    await expect.poll(() => service.rows.length).toBe(1)
    const original = structuredClone(service.rows[0])
    await expect
      .poll(async () => (await localRecord(page, original.id))?.pending)
      .toBe(true)
    await expect.poll(() => retryStarted).toBe(true)
    expect(service.loseResponse).toBe(false)
    release()
    await expect.poll(() => service.writes).toBeGreaterThanOrEqual(2)
    await expect
      .poll(async () => (await localRecord(page, original.id))?.pending)
      .toBe(false)
    await expect(page.getByLabel('实验账号与同步')).toContainText('待同步 0 条')
    expect(service.rows).toHaveLength(1)
    expect(service.writes).toBeGreaterThanOrEqual(2)
    expect(service.rows[0]).toEqual(original)
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
      await expect
        .poll(async () => (await localRecord(device, original.id))?.pending)
        .toBe(false)
      const restored = await localRecord(device, original.id)
      expect(restored?.owner).toBe(owner)
      expect(restored?.record.plan).toEqual(original.parameters)
      expect(restored?.record.rows).toEqual(original.results)
    } finally {
      await context.close()
    }
  } finally {
    release()
  }
})

test('a concurrent GET reconciles a lost insert response without a second write', async ({
  page,
  context,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  const device = await context.newPage()
  const second = await fixture(device)
  second.rows = service.rows
  await device.goto('http://127.0.0.1:4177/CC/#/signallab')
  await expect(device.getByText('云端同步完成。')).toBeVisible()
  let releaseGet!: () => void
  let releasePost!: () => void
  const getGate = new Promise<void>((resolve) => {
    releaseGet = resolve
  })
  const postGate = new Promise<void>((resolve) => {
    releasePost = resolve
  })
  let getStarted = false
  let getReturned = false
  await page.route('**/rest/v1/experiment_records*', async (route) => {
    if (route.request().method() !== 'GET' || getStarted)
      return route.fallback()
    getStarted = true
    await getGate
    getReturned = true
    return route.fulfill({
      json: service.rows.filter((row) => row.user_id === owner),
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4177' },
    })
  })
  await device.route('**/rest/v1/experiment_records*', async (route) => {
    if (route.request().method() === 'POST' && second.writes >= 1)
      await postGate
    await route.fallback()
  })
  try {
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await expect.poll(() => getStarted).toBe(true)
    second.loseResponse = true
    await section(device)
      .getByRole('button', { name: '确认方案并运行', exact: true })
      .click()
    await expect.poll(() => service.rows.length).toBe(1)
    const original = structuredClone(service.rows[0])
    expect(original.user_id).toBe(owner)
    expect(second.loseResponse).toBe(false)
    await expect
      .poll(async () => (await localRecord(device, original.id))?.pending)
      .toBe(true)
    expect(second.writes).toBe(1)
    releaseGet()
    await expect.poll(() => getReturned).toBe(true)
    await expect
      .poll(async () => (await localRecord(page, original.id))?.pending)
      .toBe(false)
    await expect(page.getByLabel('实验账号与同步')).toContainText('待同步 0 条')
    const reconciled = await localRecord(page, original.id)
    expect(reconciled?.owner).toBe(owner)
    expect(reconciled?.record.id).toBe(original.id)
    expect(reconciled?.record.plan).toEqual(original.parameters)
    expect(reconciled?.record.rows).toEqual(original.results)
    expect(service.rows).toEqual([original])
    expect(second.writes).toBe(1)
    expect(service.writes).toBe(0)
  } finally {
    releaseGet()
    releasePost()
    await device.close()
  }
})

test('sign-out and account switch cancel an old in-flight reconciliation', async ({
  page,
}) => {
  const service = await fixture(page)
  await page.goto('./#/signallab')
  await expect(page.getByText('云端同步完成。')).toBeVisible()
  service.rows = [cloudRecord()]
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let settled = false
  await page.route('**/rest/v1/experiment_records*', async (route) => {
    if (route.request().method() !== 'GET' || started) return route.fallback()
    started = true
    await gate
    try {
      await route.fulfill({
        json: service.rows,
        headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4177' },
      })
    } catch {
      // Sign-out may abort the request before the delayed response is delivered.
    } finally {
      settled = true
    }
  })
  try {
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await expect.poll(() => started).toBe(true)
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByText('未登录，实验仍在本地运行。')).toBeVisible()
    await page.evaluate(
      ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
      { key: storageKey, data: session(other) },
    )
    await page.reload()
    await expect(page.getByText('已登录：22@fixture.invalid')).toBeVisible()
    release()
    await expect.poll(() => settled).toBe(true)
    await expect(section(page).locator('#guided-history option')).toHaveText([
      '尚无完成记录',
    ])
    expect(service.rows).toEqual([cloudRecord()])
  } finally {
    release()
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
  await expect(page.getByText('未登录，实验仍在本地运行。')).toBeVisible()
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
