import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { simulateQam16 } from '../src/lib/qam16.js'
import { comparisonBit } from '../src/lib/modulationComparison.js'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/signallab')
})

test('16QAM validates groups, shows all ideal points, restores noiseless bits and zero EVM', async ({
  page,
}) => {
  const qam = page.getByRole('region', { name: '16QAM 与星座图', exact: true })
  await expect(qam.locator('circle.qam-ideal')).toHaveCount(16)
  await page.getByLabel('16QAM 输入比特流', { exact: true }).fill('001')
  await expect(qam.getByRole('alert')).toContainText('4 的倍数')
  await page
    .getByLabel('16QAM 输入比特流', { exact: true })
    .fill('0000010111111010')
  await page.getByLabel('16QAM 随机种子', { exact: true }).fill('4294967295')
  await page.getByLabel('启用 16QAM AWGN 噪声', { exact: true }).uncheck()
  await expect(page.getByLabel('16QAM 恢复比特', { exact: true })).toHaveText(
    '0000010111111010',
  )
  await expect(
    page.getByLabel('16QAM EVM 测量', { exact: true }),
  ).toContainText('0.000%')
  await expect(page.getByLabel('BPSK EVM 测量', { exact: true })).toContainText(
    '实轴',
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('16QAM reports retain current samples, energy model, chart and EVM', async ({
  page,
}) => {
  const downloadEvent = page.waitForEvent('download')
  await page
    .getByRole('group', { name: '16QAM报告导出', exact: true })
    .getByRole('button', { name: '导出 HTML 报告' })
    .click()
  const download = await downloadEvent
  const html = await readFile((await download.path())!, 'utf8')
  expect(download.suggestedFilename()).toContain('16QAM')
  expect(html).toContain('平均Es=4')
  expect(html).toContain('RMS EVM')
  expect(html).toContain('data:image/svg+xml;base64,')
  expect(html).toContain('0.140981')
})

test('comparison Worker completes all 30 points with seed wrap, exact QAM counts and export', async ({
  page,
}) => {
  const comparison = page.getByRole('region', {
    name: '三调制 BER 与性能对比',
    exact: true,
  })
  await page
    .getByRole('combobox', { name: '对比每点比特数', exact: true })
    .selectOption('16384')
  await page.getByLabel('对比基础种子', { exact: true }).fill('4294967295')
  await comparison.getByRole('button', { name: '开始三调制对比' }).click()
  await expect(comparison.getByRole('status').first()).toHaveText(
    '对比完成：30/30 点',
  )
  const rows = comparison.locator('tbody tr')
  await expect(rows).toHaveCount(30)
  await expect(rows.nth(3).locator('td').nth(1)).toHaveText('0')
  const input = Array.from({ length: 16384 }, (_, i) => comparisonBit(i))
  for (const index of [0, 4, 9]) {
    const expected = simulateQam16(
      input,
      -4 + 2 * index,
      (0xffffffff + index) >>> 0,
    )
    await expect(
      rows
        .nth(index * 3 + 2)
        .locator('td')
        .nth(3),
    ).toHaveText(String(expected.errors))
    expect(
      await rows
        .nth(index * 3)
        .locator('td')
        .nth(4)
        .textContent(),
    ).toEqual(
      await rows
        .nth(index * 3 + 1)
        .locator('td')
        .nth(4)
        .textContent(),
    )
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const downloadEvent = page.waitForEvent('download')
  await page
    .getByRole('group', { name: 'COMPARISON报告导出', exact: true })
    .getByRole('button', { name: '导出 Markdown 报告' })
    .click()
  const report = await readFile((await (await downloadEvent).path())!, 'utf8')
  expect(report).toContain('30/30')
  expect(report).toContain('不提供置信带')
  expect(report).toContain('4294967295')
})

test('comparison cancellation ignores stale Worker dispatch and re-enables parameters', async ({
  page,
}) => {
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message: unknown) {
      addEventListener('release-comparison', () => post.call(this, message), {
        once: true,
      })
    }
  })
  const comparison = page.getByRole('region', {
    name: '三调制 BER 与性能对比',
    exact: true,
  })
  await comparison.getByRole('button', { name: '开始三调制对比' }).click()
  await expect(page.getByLabel('对比基础种子', { exact: true })).toBeDisabled()
  await comparison.getByRole('button', { name: '取消三调制对比' }).click()
  await page.evaluate(() => dispatchEvent(new Event('release-comparison')))
  await expect(comparison.getByRole('status').first()).toContainText(
    '对比已取消：保留 0/30',
  )
  await expect(page.getByLabel('对比基础种子', { exact: true })).toBeEnabled()
})

test('16QAM tutor sends the new context and EVM metrics', async ({ page }) => {
  let context: { experiment: string; data: { evmPercent: number } } | undefined
  await page.route('**/api/ai-tutor', async (route) => {
    context = route.request().postDataJSON().context
    await route.fulfill({ json: { answer: '16QAM 每符号携带四比特。' } })
  })
  const tutor = page
    .getByRole('region', { name: '16QAM 与星座图', exact: true })
    .locator('details.ai-tutor')
  await tutor.locator('summary').first().click()
  await tutor.getByLabel('向实验助教提问').fill('解释 EVM')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(tutor.getByRole('log')).toContainText('四比特')
  expect(context?.experiment).toBe('16QAM')
  expect(context?.data.evmPercent).toBeGreaterThan(0)
})
