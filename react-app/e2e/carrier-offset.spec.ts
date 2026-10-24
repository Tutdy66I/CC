import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  defaultCarrierPlan,
  runCarrierExperiment,
} from '../src/lib/carrierOffset.js'

test('malformed Worker output fails visibly and allows a clean retry', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  for (const payload of [
    null,
    { type: 'error', message: {} },
    { type: 'progress', completed: 1, total: 0 },
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
    await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
    await expect(region.getByRole('alert')).toContainText('无效消息')
    await expect(
      region.getByRole('button', { name: '确认偏移方案并运行' }),
    ).toBeEnabled()
    await expect(region.locator('tbody tr')).toHaveCount(0)
    await page.reload()
  }
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
})

test('concurrent history changes and storage failures preserve results for export', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  // Wait for lazy SignalLab mounting, so this is a concurrent change rather than
  // corrupt initial history (covered separately below).
  await expect(
    region.getByRole('button', { name: '确认偏移方案并运行' }),
  ).toBeVisible()
  await page.evaluate(() =>
    localStorage.setItem('signallab-carrier-offset-v1', 'external-change'),
  )
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  await expect(
    region.getByText('另一页面已修改历史', { exact: false }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('signallab-carrier-offset-v1'),
    ),
  ).toBe('external-change')
  await page.evaluate(() =>
    localStorage.removeItem('signallab-carrier-offset-v1'),
  )
  await page.reload()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'signallab-carrier-offset-v1')
        throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  await expect(region.getByText('本地保存失败', { exact: false })).toBeVisible()
  await expect(
    region.getByRole('button', { name: '导出偏移记录 JSON' }),
  ).toBeEnabled()
})

test('confirmed real Worker snapshots reproduce all modulations, persist and export without cloud writes', async ({
  page,
}) => {
  const errors: string[] = []
  const remote: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (r) => {
    if (/supabase|\/api\//.test(r.url())) remote.push(r.url())
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await expect(region.locator('tbody tr')).toHaveCount(0)
  await region.getByLabel('偏移扫描点').fill('0,30')
  for (const modulation of ['BPSK', 'QPSK', '16QAM']) {
    await region.getByLabel('偏移调制方式').selectOption(modulation)
    await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
    await expect(region.getByRole('status')).toContainText('实验完成')
    await expect(region.locator('tbody tr')).toHaveCount(2)
    const download = page.waitForEvent('download')
    await region.getByRole('button', { name: '导出偏移记录 JSON' }).click()
    const record = JSON.parse(
      await readFile((await (await download).path())!, 'utf8'),
    )
    const expected = runCarrierExperiment(
      {
        ...defaultCarrierPlan(),
        modulation: record.plan.modulation,
        offsets: [0, 30],
      },
      () => {},
    )
    expect(record.plan.modulation).toBe(modulation)
    expect(
      record.rows.map((r: { totalErrors: number }) => r.totalErrors),
    ).toEqual(expected.map((r) => r.totalErrors))
    expect(record.engineVersion).toBe('carrier-offset-v1')
  }
  const before = await region.locator('tbody').innerText()
  await region.getByLabel('偏移基础种子').fill('7')
  expect(await region.locator('tbody').innerText()).toBe(before)
  await page.reload()
  await expect(region.locator('tbody')).toHaveText(before, {
    useInnerText: true,
  })
  await expect(region.getByLabel('偏移历史记录').locator('option')).toHaveCount(
    3,
  )
  await region.getByRole('button', { name: '载入偏移方案' }).click()
  await expect(region.getByLabel('偏移基础种子')).toHaveValue('42')
  expect(remote).toEqual([])
  expect(errors).toEqual([])
})

test('frequency scan handles noiseless phase drift and invalid parameters', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await region.getByLabel('偏移实验类型').selectOption('frequency')
  await region.getByLabel('偏移扫描点').fill('-0.25,0,0.25')
  await region.getByLabel('偏移启用 AWGN').uncheck()
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  await expect(region.getByRole('img', { name: '偏移相位轨迹' })).toBeVisible()
  await expect(region.locator('tbody tr')).toHaveCount(3)
  await region.getByLabel('偏移扫描点').fill('0.5')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('alert')).toBeVisible()
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByLabel('偏移基础种子').fill('')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('alert')).toContainText('种子')
})

test('corrupt and future history is visible and never overwritten by new runs', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('signallab-carrier-offset-v1', '[{"version":99}]'),
  )
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await expect(region.getByText('已有记录无法校验')).toBeVisible()
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('status')).toContainText('实验完成')
  expect(
    await page.evaluate(() =>
      localStorage.getItem('signallab-carrier-offset-v1'),
    ),
  ).toBe('[{"version":99}]')
  await expect(
    region.getByRole('button', { name: '导出偏移记录 JSON' }),
  ).toBeEnabled()
})

test('cancelled Worker messages cannot finish a replacement run, and Worker errors recover', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker
    const old: Array<() => void> = [],
      fresh: Array<() => void> = []
    let generation = 0,
      release = false
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const instance = ++generation
        this.addEventListener('message', (event) => {
          if (instance > 1 && release) return
          event.stopImmediatePropagation()
          const callback = this.onmessage
          const queue = instance === 1 ? old : fresh
          queue.push(() => callback?.call(this, event))
          document.body.dataset[instance === 1 ? 'oldCarrier' : 'newCarrier'] =
            String(queue.length)
        })
      }
    }
    addEventListener('replay-old-carrier', () => old.forEach((fn) => fn()))
    addEventListener('release-carrier', () => {
      release = true
      fresh.forEach((fn) => fn())
    })
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '相位与频率偏移实验',
    exact: true,
  })
  await region.getByLabel('偏移扫描点').fill('0')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-old-carrier', '6')
  await expect(region.getByLabel('偏移基础种子')).toBeDisabled()
  await region.getByRole('button', { name: '取消偏移实验' }).click()
  await region.getByLabel('偏移基础种子').fill('7')
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-new-carrier', '6')
  await page.evaluate(() => dispatchEvent(new Event('replay-old-carrier')))
  await expect(region.getByRole('status')).toContainText('计算中')
  await expect(region.locator('tbody tr')).toHaveCount(0)
  await page.evaluate(() => dispatchEvent(new Event('release-carrier')))
  await expect(region.getByRole('status')).toContainText('实验完成')
  await expect(region.getByText('基础种子 7', { exact: false })).toBeVisible()
  await page.evaluate(() => {
    const Native = window.Worker
    window.Worker = class extends Native {
      postMessage() {
        setTimeout(
          () =>
            this.dispatchEvent(new ErrorEvent('error', { cancelable: true })),
          0,
        )
      }
    }
  })
  await region.getByRole('button', { name: '确认偏移方案并运行' }).click()
  await expect(region.getByRole('alert')).toContainText('计算失败')
  await expect(
    region.getByRole('button', { name: '确认偏移方案并运行' }),
  ).toBeEnabled()
})
