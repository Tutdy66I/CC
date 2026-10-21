import { expect, test } from '@playwright/test'

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
