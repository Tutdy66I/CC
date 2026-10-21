import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { simulateBerPoint } from '../src/lib/berSweep.js'
import { simulateComparisonPoint } from '../src/lib/modulationComparison.js'
import { statisticsSeed } from '../src/lib/seedStatistics.js'

const experiments = [
  {
    name: 'BER 曲线实验',
    script: 'berSweep',
    start: '开始 BER 扫描',
    cancel: '取消扫描',
    bits: '每点比特数',
    value: '10000',
    seedLabel: '扫描基础种子',
    errorColumn: 2,
    done: '扫描完成：8/8 点',
  },
  {
    name: '三调制 BER 与性能对比',
    script: 'modulationComparison',
    start: '开始三调制对比',
    cancel: '取消三调制对比',
    bits: '对比每点比特数',
    value: '16384',
    seedLabel: '对比基础种子',
    errorColumn: 3,
    done: '对比完成：30/30 点',
  },
  {
    name: '多种子 BER 统计验证',
    script: 'seedStatistics',
    start: '开始多种子统计',
    cancel: '取消多种子统计',
    bits: '统计每次比特数',
    value: '16384',
    seedLabel: '统计基础种子',
    errorColumn: 2,
    done: '统计完成：150/150 次调制试验',
  },
] as const

for (const experiment of experiments) {
  test(`${experiment.script}: partial cancellation retains results, ignores late old messages and restarts`, async ({
    page,
  }) => {
    // Gate delivery after the first REAL result; preserve the old callback to
    // replay actual queued messages even after terminate()/a replacement Worker.
    await page.addInitScript(() => {
      const NativeWorker = window.Worker
      const held: Array<() => void> = []
      const fresh: Array<() => void> = []
      let generation = 0
      let blockNew = true
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          const instance = ++generation
          let delivered = 0
          this.addEventListener('message', (event) => {
            if (instance === 1 && delivered++ === 0) return
            if (instance > 1 && !blockNew) return
            event.stopImmediatePropagation()
            const callback = this.onmessage
            if (instance > 1) {
              fresh.push(() => callback?.call(this, event))
              document.body.dataset.newHeldMessages = String(fresh.length)
              return
            }
            held.push(() => callback?.call(this, event))
            document.body.dataset.heldMessages = String(held.length)
          })
        }
      }
      addEventListener('e2e-release-new', () => {
        blockNew = false
        for (const callback of fresh) callback()
      })
      addEventListener('e2e-replay', () => {
        for (const callback of held) callback()
      })
    })
    await page.goto('/#/signallab')
    const section = page.getByRole('region', {
      name: experiment.name,
      exact: true,
    })
    await section
      .getByRole('combobox', { name: experiment.bits, exact: true })
      .selectOption(experiment.value)
    if (experiment.script === 'seedStatistics')
      await section
        .getByRole('combobox', { name: '统计重复次数', exact: true })
        .selectOption('5')
    await section.getByRole('button', { name: experiment.start }).click()
    await expect(section.locator('tbody tr')).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(() => Number(document.body.dataset.heldMessages ?? 0)),
      )
      .toBeGreaterThan(0)
    const partial = await section.locator('tbody').innerText()
    await section.getByRole('button', { name: experiment.cancel }).click()
    await page.evaluate(() => dispatchEvent(new Event('e2e-replay')))
    await expect(section.getByRole('status').first()).toContainText('已取消')
    expect(await section.locator('tbody').innerText()).toBe(partial)
    await expect(
      section.getByRole('combobox', { name: experiment.bits, exact: true }),
    ).toBeEnabled()
    if (experiment.script === 'seedStatistics') {
      await expect(section.locator('tbody')).toContainText('等待完整重复次数')
      const downloaded = page.waitForEvent('download')
      await section.getByRole('button', { name: '导出统计 CSV' }).click()
      const csv = await readFile((await (await downloaded).path())!, 'utf8')
      expect(csv).toContain('status=cancelled')
      expect(csv.split('\r\n').at(-1)).toMatch(/,"",""$/)
    }
    await section.getByLabel(experiment.seedLabel, { exact: true }).fill('7')
    await section.getByRole('button', { name: experiment.start }).click()
    await expect
      .poll(() =>
        page.evaluate(() => Number(document.body.dataset.newHeldMessages ?? 0)),
      )
      .toBeGreaterThan(0)
    await page.evaluate(() => dispatchEvent(new Event('e2e-replay')))
    // A new Worker exists, but none of its messages have been released. Old
    // callbacks must neither fill its table nor finish this different-seed run.
    await expect(section.getByRole('status').first()).toContainText('计算中')
    await expect(section.locator('tbody tr')).toHaveCount(0)
    await page.evaluate(() => dispatchEvent(new Event('e2e-release-new')))
    await expect(section.getByRole('status').first()).toHaveText(
      experiment.done,
    )
    const bits = Number(experiment.value)
    const expectedErrors =
      experiment.script === 'berSweep'
        ? simulateBerPoint(-4, bits, 7).errors
        : experiment.script === 'modulationComparison'
          ? simulateComparisonPoint('BPSK', -4, bits, 7).errors
          : Array.from(
              { length: 5 },
              (_, trial) =>
                simulateComparisonPoint(
                  'BPSK',
                  -4,
                  bits,
                  statisticsSeed(7, trial, 0),
                ).errors,
            ).reduce((a, b) => a + b, 0)
    await expect(
      section
        .locator('tbody tr')
        .first()
        .locator('td')
        .nth(experiment.errorColumn),
    ).toHaveText(String(expectedErrors))
  })

  test(`${experiment.script}: real module failure releases controls and retry recovers`, async ({
    page,
  }) => {
    const pattern = `**/assets/${experiment.script}.worker-*.js`
    await page.route(pattern, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'throw new Error("controlled module failure")',
      }),
    )
    await page.goto('/#/signallab')
    const section = page.getByRole('region', {
      name: experiment.name,
      exact: true,
    })
    await section
      .getByRole('combobox', { name: experiment.bits, exact: true })
      .selectOption(experiment.value)
    if (experiment.script === 'seedStatistics')
      await section
        .getByRole('combobox', { name: '统计重复次数', exact: true })
        .selectOption('5')
    await section.getByRole('button', { name: experiment.start }).click()
    await expect(section.getByRole('alert')).toContainText('后台计算失败')
    await expect(section.locator('tbody tr')).toHaveCount(0)
    await expect(
      section.getByRole('combobox', { name: experiment.bits, exact: true }),
    ).toBeEnabled()
    await page.unroute(pattern)
    await section.getByRole('button', { name: experiment.start }).click()
    await expect(section.getByRole('status').first()).toHaveText(
      experiment.done,
    )
  })

  test(`${experiment.script}: computation error after one actual result preserves it`, async ({
    page,
  }) => {
    const pattern = `**/assets/${experiment.script}.worker-*.js`
    await page.route(pattern, async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      // Throw inside the real computation's try/catch on its second result.
      // Its original catch emits the error protocol; no fake numerical results.
      const prefix = `const originalPost=self.postMessage.bind(self);let results=0;self.postMessage=(message)=>{if((message.type==='point'||message.type==='summary')&&++results===2)throw new Error('controlled computation failure');originalPost(message)};\n`
      await route.fulfill({
        response,
        body: prefix + source,
        contentType: 'text/javascript',
        // Production hashed assets are immutable. The injected fixture must
        // never survive unroute() in WebKit's Worker resource cache.
        headers: { ...response.headers(), 'cache-control': 'no-store' },
      })
    })
    await page.goto('/#/signallab')
    const section = page.getByRole('region', {
      name: experiment.name,
      exact: true,
    })
    await section
      .getByRole('combobox', { name: experiment.bits, exact: true })
      .selectOption(experiment.value)
    if (experiment.script === 'seedStatistics')
      await section
        .getByRole('combobox', { name: '统计重复次数', exact: true })
        .selectOption('5')
    await section.getByRole('button', { name: experiment.start }).click()
    await expect(section.getByRole('alert')).toContainText(
      'controlled computation failure',
    )
    await expect(section.locator('tbody tr')).toHaveCount(1)
    await expect(section.getByRole('status').first()).toContainText('失败')
    await page.unroute(pattern)
    await section.getByRole('button', { name: experiment.start }).click()
    await expect(section.getByRole('status').first()).toHaveText(
      experiment.done,
    )
  })
}
