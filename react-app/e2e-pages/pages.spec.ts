import { expect, test } from '@playwright/test'

test('v0.9.1 paired compensation runs locally under the repository subpath', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Pages baseURL required')
  const origin = new URL(baseURL).origin,
    calls: string[] = []
  const isService = (url: URL) =>
    url.origin !== origin || url.pathname.includes('/api/')
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (isService(u)) calls.push(`${u.origin}${u.pathname}`)
  })
  await page.route('**/*', (route) =>
    isService(new URL(route.request().url()))
      ? route.abort()
      : route.continue(),
  )
  await page.goto('./#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await region.getByLabel('补偿扫描点').fill('0,60')
  await region.getByLabel('补偿启用 AWGN').uncheck()
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  await expect(region.locator('tbody tr')).toHaveCount(4)
  const download = page.waitForEvent('download')
  await region.getByRole('button', { name: '导出补偿记录 JSON' }).click()
  expect((await download).suggestedFilename()).toMatch(
    /^SignalLab-compensation-.*\.json$/,
  )
  await page.reload()
  await expect(region.locator('tbody tr')).toHaveCount(4)
  expect(calls).toEqual([])
})

test('v0.9 carrier Worker runs and exports locally under the static repository subpath', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Pages baseURL is required')
  const applicationOrigin = new URL(baseURL).origin
  const isServiceRequest = (url: URL) =>
    url.origin !== applicationOrigin || url.pathname.includes('/api/')
  const calls: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (isServiceRequest(url)) {
      calls.push(`${url.origin}${url.pathname}`)
    }
  })
  // A cloud-enabled build may load a same-origin supabaseClient-*.js asset.
  // Count and block actual external/API calls, never contact a real service.
  await page.route('**/*', (route) =>
    isServiceRequest(new URL(route.request().url()))
      ? route.abort()
      : route.continue(),
  )
  await page.goto('./#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await region.getByLabel('偏移扫描点').fill('0,30')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  await expect(region.locator('tbody tr')).toHaveCount(2)
  const download = page.waitForEvent('download')
  await region.getByRole('button', { name: '导出偏移记录 JSON' }).click()
  expect((await download).suggestedFilename()).toMatch(
    /^SignalLab-carrier-.*\.json$/,
  )
  await page.reload()
  await expect(region.locator('tbody tr')).toHaveCount(2)
  expect(calls).toEqual([])
})

test('v0.8 static guided experiment runs without an AI API and exports a completed snapshot', async ({
  page,
}) => {
  let calls = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls++
  })
  await page.goto('./#/signallab')
  const section = page.getByRole('region', {
    name: 'AI 引导式实验',
    exact: true,
  })
  await expect(
    section.getByRole('button', { name: 'AI 建议参数', exact: true }),
  ).toBeDisabled()
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('status')).toContainText('实验完成')
  await expect(section.locator('tbody tr')).toHaveCount(6)
  await expect(
    section.getByRole('button', { name: 'AI 分析本次结果', exact: true }),
  ).toBeDisabled()
  const downloadEvent = page.waitForEvent('download')
  await section.getByRole('button', { name: '导出实验记录 JSON' }).click()
  expect((await downloadEvent).suggestedFilename()).toMatch(
    /^SignalLab-guided-.*\.json$/,
  )
  expect(calls).toBe(0)
})

test('v0.7 statistics Worker works under the repository subpath', async ({
  page,
}) => {
  await page.goto('./#/signallab')
  const section = page.getByRole('region', {
    name: '多种子 BER 统计验证',
    exact: true,
  })
  await section
    .getByRole('combobox', { name: '统计每次比特数', exact: true })
    .selectOption('16384')
  await section
    .getByRole('combobox', { name: '统计重复次数', exact: true })
    .selectOption('5')
  await section.getByRole('button', { name: '开始多种子统计' }).click()
  await expect(section.getByRole('status')).toHaveText(
    '统计完成：150/150 次调制试验',
  )
  await expect(section.locator('tbody tr')).toHaveCount(30)
})

test('v0.6 static edition supports 16QAM EVM and the three-modulation Worker', async ({
  page,
}) => {
  await page.goto('./#/signallab')
  await page.getByLabel('启用 16QAM AWGN 噪声', { exact: true }).uncheck()
  await expect(
    page.getByLabel('16QAM EVM 测量', { exact: true }),
  ).toContainText('0.000%')
  await page
    .getByRole('combobox', { name: '对比每点比特数', exact: true })
    .selectOption('16384')
  const comparison = page.getByRole('region', {
    name: '三调制 BER 与性能对比',
    exact: true,
  })
  await comparison.getByRole('button', { name: '开始三调制对比' }).click()
  await expect(comparison.getByRole('status').first()).toHaveText(
    '对比完成：30/30 点',
  )
  await expect(comparison.locator('tbody tr')).toHaveCount(30)
})

test('repository subpath loads SignalLab, public icons and the static-host notice', async ({
  page,
  baseURL,
}) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto('./#/signallab')
  await expect(
    page.getByRole('heading', { name: 'SignalLab AI', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('note')).toContainText('GitHub Pages')
  const icon = page.locator('nav svg use').first()
  await expect(icon).toHaveAttribute(
    'href',
    `${new URL(baseURL!).pathname}icons.svg#claude-icon`,
  )
  const response = await page.request.get(new URL('icons.svg', baseURL).href)
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('claude-icon')
  expect(failures).toEqual([])
})

test('static deployment runs its bundled BER Worker and downloads a report', async ({
  page,
}) => {
  await page.goto('./#/signallab')
  await page
    .getByRole('combobox', { name: '每点比特数', exact: true })
    .selectOption('10000')
  const sweep = page.getByRole('region', { name: 'BER 曲线实验', exact: true })
  await sweep.getByRole('button', { name: '开始 BER 扫描' }).click()
  await expect(sweep.getByRole('status').first()).toHaveText('扫描完成：8/8 点')
  await expect(sweep.locator('tbody tr')).toHaveCount(8)
  const downloadEvent = page.waitForEvent('download')
  await page
    .getByRole('group', { name: 'BPSK报告导出', exact: true })
    .getByRole('button', { name: '导出 HTML 报告' })
    .click()
  expect((await downloadEvent).suggestedFilename()).toMatch(
    /^SignalLab-BPSK-.*\.html$/,
  )
})

test('static tutor gives an explicit backend requirement without making an API call', async ({
  page,
}) => {
  let apiCalls = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiCalls++
  })
  await page.goto('./#/signallab')
  const tutor = page.locator('details.ai-tutor').first()
  await tutor.locator('summary').first().click()
  await tutor.getByLabel('向实验助教提问').fill('解释当前结果')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(tutor.getByRole('alert')).toContainText('Node 后端')
  expect(apiCalls).toBe(0)
})
