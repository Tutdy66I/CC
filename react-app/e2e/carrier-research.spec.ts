import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { runCarrierResearch } from '../src/lib/carrierResearch.js'
const key = 'signallab-carrier-research-v11',
  draft = 'signallab-carrier-research-v11-checkpoint'
test('real research Worker separates stages, exports all trials and restores complete local history', async ({
  page,
}, testInfo) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await r.getByLabel('研究帧长').selectOption('257')
  await r.getByLabel('研究信道启用噪声').uncheck()
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  const pending = page.waitForEvent('download')
  await r.getByRole('button', { name: '导出研究记录 JSON' }).click()
  const record = JSON.parse(
    await readFile((await (await pending).path())!, 'utf8'),
  )
  expect(record.result.calibration).toHaveLength(20)
  expect(record.result.evaluation).toHaveLength(20)
  const expected = runCarrierResearch(record.result.plan, () => {})
  expect(record.result.summary[0].methods.ml.failures).toBe(
    expected.summary[0].methods.ml.failures,
  )
  expect(record.result.summary[1].methods.ml.meanCommonBer).toBeCloseTo(
    expected.summary[1].methods.ml.meanCommonBer!,
    10,
  )
  await expect(r.getByRole('img')).toHaveCount(2)
  await page.reload()
  await expect(r.getByLabel('研究实验历史').locator('option')).toHaveCount(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  if (['chromium', 'mobile-chromium'].includes(testInfo.project.name))
    await r.screenshot({
      path: `../output/playwright/signallab-v11-${testInfo.project.name}.png`,
    })
})
test('cancelled research saves a partial checkpoint and resumes after reload without fabricated intervals', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await expect(r).toBeVisible()
  await page.evaluate(() => {
    const Native = window.Worker
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        let released = false
        this.addEventListener('message', (event) => {
          event.stopImmediatePropagation()
          const callback = this.onmessage
          addEventListener(
            'replay-old-research',
            () => callback?.call(this, event),
            { once: true },
          )
          if (!released && event.data.type === 'trial') {
            released = true
            this.onmessage?.call(this, event)
            document.body.dataset.researchHeld = 'yes'
          }
        })
      }
    }
  })
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-research-held',
    'yes',
  )
  await r.getByRole('button', { name: '取消并保存研究检查点' }).click()
  await page.evaluate(() => dispatchEvent(new Event('replay-old-research')))
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull()
  const checkpoint = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    draft,
  )
  expect(checkpoint.trials).toHaveLength(1)
  await expect(
    r.getByRole('table', { name: '研究获取失败率与性能' }),
  ).toHaveCount(0)
  await page.reload()
  await r.getByRole('button', { name: '恢复研究检查点' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draft),
  ).toBeNull()
})
test('research budget validation and malformed Worker output never create a completed history', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await r.getByLabel('研究随机种子').fill('')
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('alert')).toBeVisible()
  await r.getByLabel('研究随机种子').fill('42')
  await r.getByLabel('研究帧长').selectOption('2049')
  await r.getByLabel('布局：成对 L8', { exact: true }).check()
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('alert')).toContainText('预算')
  await r.getByLabel('布局：成对 L8', { exact: true }).uncheck()
  await r.getByLabel('研究帧长').selectOption('257')
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
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('status')).toContainText('失败')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull()
})

test('corrupt research storage preserves original data and exportable memory results', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('signallab-carrier-research-v11', 'broken'),
  )
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await expect(r.getByText(/研究历史或检查点无法校验/)).toBeVisible()
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    'broken',
  )
  await expect(
    r.getByRole('button', { name: '导出研究记录 JSON' }),
  ).toBeEnabled()
})

test('concurrent history and quota errors retain research results for export', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  await expect(r).toBeVisible()
  await page.evaluate((key) => localStorage.setItem(key, '[]'), key)
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByText(/另一页面已修改研究历史/)).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    '[]',
  )
  await page.reload()
  await expect(r).toBeVisible()
  await page.evaluate((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new Error('quota')
      native.call(this, k, v)
    }
  }, key)
  await r.getByRole('button', { name: '确认研究方案并运行' }).click()
  await expect(r.getByText(/研究历史保存失败/)).toBeVisible()
  await expect(
    r.getByRole('button', { name: '导出研究记录 JSON' }),
  ).toBeEnabled()
})
