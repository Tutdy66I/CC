import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  runSeedStatistics,
  type StatisticsMessage,
} from '../src/lib/seedStatistics.js'

test('multi-seed Worker completes, wraps seeds, matches core aggregation and exports its run snapshot', async ({
  page,
}) => {
  await page.goto('/#/signallab')
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
  await section.getByLabel('统计基础种子', { exact: true }).fill('4294967295')
  await section.getByRole('button', { name: '开始多种子统计' }).click()
  await expect(section.getByRole('status')).toHaveText(
    '统计完成：150/150 次调制试验',
  )
  const rows = section.locator('tbody tr')
  await expect(rows).toHaveCount(30)
  const expected: StatisticsMessage[] = []
  runSeedStatistics({ bits: 16384, seed: 0xffffffff, trials: 5 }, (m) =>
    expected.push(m),
  )
  const finals = expected.filter(
    (m) => m.type === 'summary' && m.summary.completed === 5,
  )
  for (const index of [0, 2, 29]) {
    const message = finals[index]
    if (message.type !== 'summary') throw new Error('missing summary')
    await expect(rows.nth(index).locator('td').nth(2)).toHaveText(
      String(message.summary.totalErrors),
    )
    await expect(rows.nth(index).locator('td').last()).toContainText('[')
  }
  const original = await rows.allTextContents()
  await section.getByRole('button', { name: '开始多种子统计' }).click()
  await expect(section.getByRole('status')).toHaveText(
    '统计完成：150/150 次调制试验',
  )
  expect(await rows.allTextContents()).toEqual(original)
  await section.getByLabel('统计基础种子', { exact: true }).fill('7')
  const downloaded = page.waitForEvent('download')
  await section.getByRole('button', { name: '导出统计 CSV' }).click()
  const download = await downloaded
  const csv = await readFile((await download.path())!, 'utf8')
  expect(download.suggestedFilename()).toBe(
    'SignalLab-statistics-4294967295.csv',
  )
  expect(csv).toContain('baseSeed=4294967295')
  expect(csv).toContain('plannedTrials=5')
  expect(csv).toContain('status=done')
  expect(csv).not.toContain('baseSeed=7')
  expect(csv.split('\r\n')).toHaveLength(34)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('statistics rejects invalid seed and recovers without hiding the validation error', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const section = page.getByRole('region', {
    name: '多种子 BER 统计验证',
    exact: true,
  })
  await section.getByLabel('统计基础种子', { exact: true }).fill('')
  await section.getByRole('button', { name: '开始多种子统计' }).click()
  await expect(section.getByRole('alert')).toContainText('请输入统计基础种子')
  await expect(
    section.getByRole('button', { name: '开始多种子统计' }),
  ).toBeEnabled()
})
