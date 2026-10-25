import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const regionName = '无线衰落与信道估计研究'

test('late channel-module loading cannot move an existing experiment during a click', async ({
  page,
}) => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route(
    '**/assets/ChannelResearchExperiment-*.js',
    async (route) => {
      requested = true
      await held
      await route.continue()
    },
  )
  await page.goto('/#/signallab')
  await expect.poll(() => requested).toBe(true)
  const old = page.getByRole('region', {
    name: '载波恢复可靠性研究',
    exact: true,
  })
  const button = old.getByRole('button', { name: '确认研究方案并运行' })
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  if (!box) throw new Error('Existing experiment control is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  release()
  await expect(
    page.getByRole('region', { name: regionName, exact: true }),
  ).toBeAttached()
  await page.mouse.up()
  await expect(old.getByRole('status')).toContainText(/研究计算中|研究完成/)
})

test('channel research runs a real Worker, exports its protocol and reloads local history', async ({
  page,
}, testInfo) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', { name: regionName, exact: true })
  await expect(r).toBeVisible()
  await r.getByLabel('信道研究帧长').fill('128')
  await r.getByLabel('信道研究试验帧数').fill('20')
  await r.getByLabel('信道研究 Eb/N0 列表').fill('0,8')
  await r.getByLabel('信道研究启用噪声').uncheck()
  await r.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toBeVisible()
  await expect(
    r.getByRole('img', { name: '信道BER与理想CSI理论参考' }),
  ).toBeVisible()
  const pending = page.waitForEvent('download')
  await r.getByRole('button', { name: '导出信道研究 JSON' }).click()
  const record = JSON.parse(
    await readFile((await (await pending).path())!, 'utf8'),
  )
  expect(record.protocolHash).toMatch(/^[a-f0-9]{64}$/)
  expect(record.plan.noiseEnabled).toBe(false)
  expect(record.trials).toHaveLength(20)
  expect(record.summary.length).toBeGreaterThan(0)
  for (const trial of record.trials) {
    for (const cell of trial.cells) {
      expect(cell.methods.ideal.all.errors).toBe(0)
      expect(cell.methods.ls.all.errors).toBe(0)
    }
  }
  const damaged = { ...record, summary: [] }
  await r.getByLabel('导入信道记录或检查点').setInputFiles({
    name: 'damaged-complete.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(damaged)),
  })
  await expect(r.getByRole('alert')).toContainText('汇总')
  await expect(r.getByRole('button', { name: '恢复信道检查点' })).toBeDisabled()
  await page.reload()
  await expect(r.getByLabel('信道研究历史').locator('option')).toHaveCount(1)
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  if (['chromium', 'mobile-chromium'].includes(testInfo.project.name))
    await r.screenshot({
      path: `../output/playwright/signallab-v12-${testInfo.project.name}.png`,
    })
})

test('a failed IndexedDB write retains complete channel results for JSON export', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', { name: regionName, exact: true })
  await expect(
    r.getByRole('button', { name: '冻结信道协议并运行' }),
  ).toBeEnabled()
  await r.getByLabel('信道研究帧长').fill('128')
  await r.getByLabel('信道研究试验帧数').fill('20')
  await r.getByLabel('信道研究 Eb/N0 列表').fill('0')
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('simulated quota failure', 'QuotaExceededError')
    }
  })
  await r.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  await expect(
    r.getByText(/信道记录保存失败或另一页面已修改数据/),
  ).toBeVisible()
  await expect(
    r.getByRole('button', { name: '导出信道研究 JSON' }),
  ).toBeEnabled()
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toBeVisible()
})

test('channel research rejects invalid parameters and Worker completion without a prefix', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', { name: regionName, exact: true })
  await r.getByLabel('信道研究随机种子').fill('')
  await r.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(r.getByRole('alert')).toContainText('种子')
  await r.getByLabel('信道研究随机种子').fill('42')
  await page.evaluate(() => {
    const Native = window.Worker
    window.Worker = class extends Native {
      postMessage(request: {
        runId: string
        checkpoint: { protocolHash: string; engineVersion: string }
      }) {
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  runId: request.runId,
                  protocolHash: request.checkpoint.protocolHash,
                  engineVersion: request.checkpoint.engineVersion,
                  type: 'done',
                  record: {},
                },
              }),
            ),
          0,
        )
      }
    }
  })
  await r.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(r.getByRole('status')).toContainText('失败')
  await expect(r.getByRole('alert')).toBeVisible()
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toHaveCount(0)
})

test('channel cancellation persists only the validated prefix and resumes after reload', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const r = page.getByRole('region', { name: regionName, exact: true })
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
            'replay-old-channel',
            () => callback?.call(this, event),
            { once: true },
          )
          if (!released && event.data.type === 'batch') {
            released = true
            this.onmessage?.call(this, event)
            document.body.dataset.channelHeld = 'yes'
          }
        })
      }
    }
  })
  await r.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-channel-held', 'yes')
  await r.getByRole('button', { name: '取消并保存信道检查点' }).click()
  await page.evaluate(() => dispatchEvent(new Event('replay-old-channel')))
  await expect(r.getByRole('status')).toContainText('已取消')
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toHaveCount(0)
  await expect(
    r.getByRole('button', { name: '导出信道检查点 JSON' }),
  ).toBeEnabled()
  await page.reload()
  await r.getByRole('button', { name: '恢复信道检查点' }).click()
  await expect(r.getByRole('status')).toContainText('研究完成')
  await expect(
    r.getByRole('table', { name: '信道 BER 与统计区间' }),
  ).toBeVisible()
})
