import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { runEstimation } from '../src/lib/carrierEstimation.js'
const key = 'signallab-carrier-estimation-v1'
test('real pilot Worker exports paired measurements, reloads history and supports all modulations', async ({
  page,
}, testInfo) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await expect(region).toBeVisible()
  for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
    await region.getByLabel('估计调制方式').selectOption(modulation)
    await region.getByLabel('估计信道启用噪声').uncheck()
    await region.getByLabel('估计真实初相位（度）').fill('180')
    await region.getByRole('button', { name: '确认估计方案并运行' }).click()
    await expect(region.getByRole('status')).toContainText('估计实验完成')
    await expect(region.getByRole('img')).toHaveCount(5)
    const pending = page.waitForEvent('download')
    await region.getByRole('button', { name: '导出估计记录 JSON' }).click()
    const record = JSON.parse(
      await readFile((await (await pending).path())!, 'utf8'),
    )
    const expected = runEstimation(record.plan)
    expect(record.result.dataBits).toBe(expected.dataBits)
    expect(record.result.estimated.errors).toBe(0)
    expect(record.result.estimated.evmRms).toBeLessThan(1e-9)
    expect(record.result.frequencyError).toBeCloseTo(
      expected.frequencyError!,
      12,
    )
  }
  await page.reload()
  await expect(region.getByRole('status')).toContainText('等待')
  await expect(region.getByLabel('估计实验历史').locator('option')).toHaveCount(
    3,
  )
  await expect(
    region.getByRole('table', { name: '同一接收帧的数据 BER / EVM 对照' }),
  ).toContainText('理想补偿')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  if (['chromium', 'mobile-chromium'].includes(testInfo.project.name))
    await region.screenshot({
      path: `../output/playwright/signallab-v1-${testInfo.project.name}.png`,
    })
})
test('range warnings and corrupted history preserve legacy and original storage', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(key, 'broken history')
      localStorage.setItem('signallab-carrier-offset-v1', 'legacy sentinel')
    },
    { key },
  )
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await expect(region.getByText(/历史无法校验/)).toBeVisible()
  await region.getByLabel('估计真实频偏（cycles/symbol）').fill('0.0635')
  await region.getByLabel('估计信道启用噪声').uncheck()
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('估计实验完成')
  await expect(region.getByText(/真实频偏超出/)).toBeVisible()
  const errorPlot = region.getByRole('img', {
    name: '剩余相位误差（rad，使用事后真值，圆周差）',
  })
  const points = await errorPlot.locator('polyline').getAttribute('points')
  expect(
    new Set(points!.split(' ').map((p) => Number(p.split(',')[1]).toFixed(1)))
      .size,
  ).toBeGreaterThan(2)
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'broken history',
  )
  expect(
    await page.evaluate(() =>
      localStorage.getItem('signallab-carrier-offset-v1'),
    ),
  ).toBe('legacy sentinel')
})
test('invalid inputs do not create records and malformed Worker messages fail safely', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await region.getByLabel('估计随机种子').fill('')
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByRole('alert')).toBeVisible()
  await region.getByLabel('估计随机种子').fill('42')
  await page.evaluate(() => {
    const Native = window.Worker
    window.Worker = class extends Native {
      postMessage() {
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent('message', {
                data: { type: 'done', result: {} },
              }),
            ),
          0,
        )
      }
    }
  })
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('失败')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull()
})
test('cancelled Worker cannot publish late results; next run remains valid', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker
    let pending: (() => void) | undefined,
      generation = 0
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const first = ++generation === 1
        this.addEventListener('message', (event) => {
          if (!first) return
          event.stopImmediatePropagation()
          const cb = this.onmessage
          pending = () => cb?.call(this, event)
          document.body.dataset.estimationPending = 'yes'
        })
      }
    }
    addEventListener('replay-estimation', () => pending?.())
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-estimation-pending',
    'yes',
  )
  await region.getByRole('button', { name: '取消估计实验' }).click()
  await page.evaluate(() => dispatchEvent(new Event('replay-estimation')))
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull()
  await region.getByLabel('估计随机种子').fill('7')
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('估计实验完成')
  const record = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!)[0],
    key,
  )
  expect(record.plan.seed).toBe(7)
})

test('concurrent history changes and storage failure preserve exportable memory results', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '载波估计与恢复实验',
    exact: true,
  })
  await expect(region).toBeVisible()
  await page.evaluate(
    (key) => localStorage.setItem(key, 'changed by another tab'),
    key,
  )
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByText(/另一页面已修改估计历史/)).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'changed by another tab',
  )
  await expect(
    region.getByRole('button', { name: '导出估计记录 JSON' }),
  ).toBeEnabled()
  await page.evaluate((key) => localStorage.removeItem(key), key)
  await page.reload()
  await page.evaluate((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new Error('quota')
      native.call(this, k, v)
    }
  }, key)
  await region.getByRole('button', { name: '确认估计方案并运行' }).click()
  await expect(region.getByText(/估计历史保存失败/)).toBeVisible()
  await expect(
    region.getByRole('button', { name: '导出估计记录 JSON' }),
  ).toBeEnabled()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull()
})
