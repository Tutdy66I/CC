import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  defaultCarrierPlan,
  runCarrierExperiment,
} from '../src/lib/carrierOffset.js'
import { runCompensationExperiment } from '../src/lib/carrierCompensation.js'
import { makeCarrierRecord } from '../src/lib/carrierOffsetRecord.js'

test('cancelled real paired Worker cannot finish a new-seed run through late messages', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      old: Array<() => void> = [],
      fresh: Array<() => void> = []
    let generation = 0,
      release = false
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const current = ++generation
        this.addEventListener('message', (event) => {
          if (current > 1 && release) return
          event.stopImmediatePropagation()
          const callback = this.onmessage,
            queue = current === 1 ? old : fresh
          queue.push(() => callback?.call(this, event))
          document.body.dataset[current === 1 ? 'oldPair' : 'newPair'] = String(
            queue.length,
          )
        })
      }
    }
    addEventListener('replay-old-pair', () => old.forEach((fn) => fn()))
    addEventListener('release-pair', () => {
      release = true
      fresh.forEach((fn) => fn())
    })
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await region.getByLabel('补偿扫描点').fill('60')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-old-pair', '6')
  await expect(region.getByLabel('补偿基础种子')).toBeDisabled()
  await region.getByRole('button', { name: '取消补偿实验' }).click()
  await region.getByLabel('补偿基础种子').fill('7')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-new-pair', '6')
  await page.evaluate(() => dispatchEvent(new Event('replay-old-pair')))
  await expect(region.getByRole('status')).toContainText('计算中')
  await expect(region.locator('tbody tr')).toHaveCount(0)
  await page.evaluate(() => dispatchEvent(new Event('release-pair')))
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  await expect(region.getByText('基础种子 7', { exact: false })).toBeVisible()
  const download = page.waitForEvent('download')
  await region.getByRole('button', { name: '导出补偿记录 JSON' }).click()
  const record = JSON.parse(
    await readFile((await (await download).path())!, 'utf8'),
  )
  const expected = runCompensationExperiment(record.plan, () => {})
  expect(record.plan.seed).toBe(7)
  expect(record.rows[0].after.totalErrors).toBe(expected[0].after.totalErrors)
})

test('malformed Worker messages fail without records and allow real retry', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  for (const payload of [
    null,
    { type: 'error', message: {} },
    { type: 'progress', total: 0, completed: 1 },
    { type: 'done', rows: [] },
  ]) {
    await page.evaluate((payload) => {
      const Native = window.Worker
      window.Worker = class extends Native {
        postMessage() {
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent('message', { data: payload }),
              ),
            0,
          )
        }
      }
    }, payload)
    await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
    await expect(region.getByRole('alert')).toBeVisible()
    await expect(
      region.getByRole('button', { name: '确认补偿方案并运行' }),
    ).toBeEnabled()
    await expect(region.locator('tbody tr')).toHaveCount(0)
    await page.reload()
  }
  await region.getByLabel('补偿扫描点').fill('0')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
})

test('concurrent local history is preserved while new paired results remain exportable', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await expect(
    region.getByRole('button', { name: '确认补偿方案并运行' }),
  ).toBeVisible()
  await page.evaluate(() =>
    localStorage.setItem(
      'signallab-carrier-compensation-v1',
      'external-change',
    ),
  )
  await region.getByLabel('补偿扫描点').fill('0')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  await expect(
    region.getByText('另一页面已修改补偿历史', { exact: false }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('signallab-carrier-compensation-v1'),
    ),
  ).toBe('external-change')
  await expect(
    region.getByRole('button', { name: '导出补偿记录 JSON' }),
  ).toBeEnabled()
})

test('real paired Worker exports all modulations and preserves legacy history across reload', async ({
  page,
}) => {
  const oldPlan = { ...defaultCarrierPlan(), bits: 64, offsets: [0] }
  const old = makeCarrierRecord(
    oldPlan,
    runCarrierExperiment(oldPlan, () => {}),
    'legacy-v09',
    '2026-10-24T00:00:00Z',
  )
  await page.addInitScript((record) => {
    if (!localStorage.getItem('signallab-carrier-offset-v1'))
      localStorage.setItem(
        'signallab-carrier-offset-v1',
        JSON.stringify([record]),
      )
  }, old)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await expect(
    region.getByRole('button', { name: '确认补偿方案并运行' }),
  ).toBeVisible({ timeout: 2000 })
  await expect(region.locator('tbody tr')).toHaveCount(0)
  await region.getByLabel('补偿扫描点').fill('0,60')
  for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
    await region.getByLabel('补偿调制方式').selectOption(modulation)
    await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
    await expect(region.getByRole('status')).toContainText('对照实验完成')
    await expect(region.locator('tbody tr')).toHaveCount(4)
    await expect(
      region.getByRole('img', { name: '未补偿星座图', exact: true }),
    ).toBeVisible()
    await expect(
      region.getByRole('img', { name: '理想补偿星座图', exact: true }),
    ).toBeVisible()
    const download = page.waitForEvent('download')
    await region.getByRole('button', { name: '导出补偿记录 JSON' }).click()
    const record = JSON.parse(
      await readFile((await (await download).path())!, 'utf8'),
    )
    const expected = runCompensationExperiment(record.plan, () => {})
    expect(record.compensation).toBe('known-truth-inverse-rotation')
    expect(
      record.rows.map(
        (r: {
          before: { totalErrors: number }
          after: { totalErrors: number }
        }) => [r.before.totalErrors, r.after.totalErrors],
      ),
    ).toEqual(expected.map((r) => [r.before.totalErrors, r.after.totalErrors]))
  }
  const snapshot = await region.locator('tbody').innerText()
  await region.getByLabel('补偿基础种子').fill('7')
  expect(await region.locator('tbody').innerText()).toBe(snapshot)
  await page.reload()
  await expect(region.locator('tbody')).toHaveText(snapshot, {
    useInnerText: true,
  })
  await expect(region.getByLabel('补偿历史记录').locator('option')).toHaveCount(
    3,
  )
  await region.getByRole('button', { name: '载入补偿方案' }).click()
  await expect(region.getByLabel('补偿基础种子')).toHaveValue('42')
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem('signallab-carrier-offset-v1'),
      ))!,
    ),
  ).toEqual([old])
  expect(errors).toEqual([])
})

test('noiseless frequency compensation recovers all modulations and validates inputs', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await region.getByLabel('补偿实验类型').selectOption('frequency')
  await region.getByLabel('补偿扫描点').fill('-0.001,0,0.001')
  await region.getByLabel('补偿启用 AWGN').uncheck()
  for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
    await region.getByLabel('补偿调制方式').selectOption(modulation)
    await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
    await expect(region.getByRole('status')).toContainText('对照实验完成')
    await expect(
      region.locator('tbody tr').filter({ hasText: '理想补偿' }),
    ).toHaveCount(3)
    const download = page.waitForEvent('download')
    await region.getByRole('button', { name: '导出补偿记录 JSON' }).click()
    const record = JSON.parse(
      await readFile((await (await download).path())!, 'utf8'),
    )
    for (const row of record.rows) {
      expect(row.after.totalErrors).toBe(0)
      expect(row.after.evmRms).toBeLessThan(1e-12)
    }
  }
  await region.getByLabel('补偿扫描点').fill('0.5')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('alert')).toBeVisible()
  await region.getByLabel('补偿扫描点').fill('0')
  await region.getByLabel('补偿基础种子').fill('')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('alert')).toContainText('种子')
})

test('unknown history and storage quota errors preserve raw data and leave results exportable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('once')) {
      localStorage.setItem(
        'signallab-carrier-compensation-v1',
        '[{"version":99}]',
      )
      localStorage.setItem('once', '1')
    }
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '理想载波补偿对照实验',
    exact: true,
  })
  await expect(
    region.getByText('已有补偿记录无法校验', { exact: false }),
  ).toBeVisible()
  await region.getByLabel('补偿扫描点').fill('0')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  expect(
    await page.evaluate(() =>
      localStorage.getItem('signallab-carrier-compensation-v1'),
    ),
  ).toBe('[{"version":99}]')
  await page.evaluate(() =>
    localStorage.removeItem('signallab-carrier-compensation-v1'),
  )
  await page.reload()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'signallab-carrier-compensation-v1')
        throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await region.getByLabel('补偿扫描点').fill('0')
  await region.getByRole('button', { name: '确认补偿方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('对照实验完成')
  await expect(
    region.getByText('补偿记录保存失败', { exact: false }),
  ).toBeVisible()
  await expect(
    region.getByRole('button', { name: '导出补偿记录 JSON' }),
  ).toBeEnabled()
})
