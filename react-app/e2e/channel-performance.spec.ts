import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

interface MessageSample {
  phase: string
  durationMs: number
  type: string
  at: number
}
interface ProgressSample {
  phase: string
  completed: number
  total: number
  at: number
}
interface BrowserPerformance {
  phase: string
  messages: MessageSample[]
  progress: ProgressSample[]
  clicks: { phase: string; at: number }[]
  longTasks: { startTime: number; durationMs: number }[]
  longTasksSupported: boolean
  cancelClickAt: number | null
  cancelledAt: number | null
}
declare global {
  interface Window {
    __channelPerformance: BrowserPerformance
  }
}

const percentile = (values: number[], fraction: number) => {
  if (!values.length) throw new Error('No performance samples were recorded.')
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

test('real channel defaults meet completion, synchronous handler and cancellation budgets', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Browser timing acceptance runs on desktop Chromium only.',
  )
  test.setTimeout(30_000)
  await page.addInitScript(() => {
    const samples: BrowserPerformance = {
      phase: 'initialization',
      messages: [],
      progress: [],
      clicks: [],
      longTasks: [],
      longTasksSupported:
        PerformanceObserver.supportedEntryTypes.includes('longtask'),
      cancelClickAt: null,
      cancelledAt: null,
    }
    window.__channelPerformance = samples
    const Native = window.Worker
    const descriptor = Object.getOwnPropertyDescriptor(
      Native.prototype,
      'onmessage',
    )
    if (!descriptor?.set)
      throw new Error('The native Worker onmessage setter is unavailable.')
    const setWorkerHandler = descriptor.set
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const channelWorker = String(url).includes('channelResearch.worker')
        let assigned: Worker['onmessage'] = null
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => assigned,
          set(callback: Worker['onmessage']) {
            assigned = callback
            setWorkerHandler.call(
              this,
              callback === null
                ? null
                : function (this: Worker, event: MessageEvent<unknown>) {
                    const before = performance.now()
                    try {
                      return callback.call(this, event)
                    } finally {
                      if (channelWorker) {
                        const data = event.data as { type?: unknown } | null
                        samples.messages.push({
                          phase: samples.phase,
                          at: before,
                          durationMs: performance.now() - before,
                          type:
                            typeof data?.type === 'string'
                              ? data.type
                              : 'unknown',
                        })
                      }
                    }
                  },
            )
          },
        })
      }
    }
    if (samples.longTasksSupported) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          samples.longTasks.push({
            startTime: entry.startTime,
            durationMs: entry.duration,
          })
      })
      observer.observe({ type: 'longtask', buffered: true })
    }
    document.addEventListener(
      'click',
      (event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest('button')
            : null
        if (target?.textContent === '冻结信道协议并运行')
          samples.clicks.push({ phase: samples.phase, at: performance.now() })
        if (target?.textContent === '取消并保存信道检查点')
          samples.cancelClickAt = performance.now()
      },
      true,
    )
    let previousStatus = ''
    const observer = new MutationObserver(() => {
      const status =
        document.querySelector(
          '[aria-labelledby="channel-title"] [role="status"]',
        )?.textContent ?? ''
      if (status === previousStatus) return
      previousStatus = status
      const at = performance.now()
      const progress = /信道研究计算中：(\d+)\/(\d+) 帧/.exec(status)
      if (progress && Number(progress[1]) > 0)
        samples.progress.push({
          phase: samples.phase,
          completed: Number(progress[1]),
          total: Number(progress[2]),
          at,
        })
      if (
        samples.cancelClickAt !== null &&
        samples.cancelledAt === null &&
        status.includes('已取消')
      )
        samples.cancelledAt = at
    })
    const observe = () =>
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    if (document.documentElement) observe()
    else document.addEventListener('DOMContentLoaded', observe, { once: true })
  })
  await page.goto('/#/signallab')
  const region = page.getByRole('region', {
    name: '无线衰落与信道估计研究',
    exact: true,
  })
  await expect(
    region.getByRole('button', { name: '冻结信道协议并运行' }),
  ).toBeEnabled()
  const completionMs: number[] = []
  for (let run = 0; run < 3; run++) {
    const phase = `default-${run + 1}`
    await page.evaluate((value) => {
      window.__channelPerformance.phase = value
    }, phase)
    await region.getByRole('button', { name: '冻结信道协议并运行' }).click()
    await expect(region.getByRole('status')).toContainText('研究完成', {
      timeout: 7000,
    })
    await expect(
      region.getByRole('table', { name: '信道 BER 与统计区间' }),
    ).toBeVisible()
    const duration = await page.evaluate(async (value) => {
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      )
      const click = window.__channelPerformance.clicks.find(
        (entry) => entry.phase === value,
      )
      if (!click)
        throw new Error('The actual freeze-button click was not recorded.')
      return performance.now() - click.at
    }, phase)
    completionMs.push(duration)
  }
  await region.getByLabel('信道研究帧长').fill('4096')
  await page.evaluate(() => {
    window.__channelPerformance.phase = 'cancellation'
  })
  await region.getByRole('button', { name: '冻结信道协议并运行' }).click()
  await expect
    .poll(
      async () =>
        Number(await region.getByRole('progressbar').getAttribute('value')),
      { timeout: 7000 },
    )
    .toBeGreaterThan(0)
  await region.getByRole('button', { name: '取消并保存信道检查点' }).click()
  await expect(region.getByRole('status')).toContainText('已取消')
  const snapshot = await page.evaluate(() => window.__channelPerformance)
  if (snapshot.cancelClickAt === null || snapshot.cancelledAt === null)
    throw new Error('Cancellation timestamps are missing.')
  const defaultMessages = snapshot.messages.filter((s) =>
    s.phase.startsWith('default-'),
  )
  const messageHandlerP95Ms = percentile(
    defaultMessages.map((s) => s.durationMs),
    0.95,
  )
  const nonFinalProgressGapsMs = snapshot.progress.flatMap((s, i, rows) => {
    const previous = rows[i - 1]
    return previous && previous.phase === s.phase && s.completed !== s.total
      ? [s.at - previous.at]
      : []
  })
  const result = {
    schemaVersion: 1,
    browser: testInfo.project.name,
    generatedAt: new Date().toISOString(),
    defaultPlan: {
      modulation: 'QPSK',
      frameSymbols: 512,
      pilotCounts: [16],
      ebN0Db: [0, 4, 8, 12],
      channels: ['awgn', 'rayleigh-block'],
      trials: 200,
      seed: 42,
      energyBasis: 'data-eb',
      noiseEnabled: true,
    },
    completion: {
      samplesMs: completionMs,
      medianMs: percentile(completionMs, 0.5),
      limitMs: 5000,
      scope:
        'Actual freeze-button click through complete status, validated result table and two animation frames; includes Worker startup, record validation and SVG DOM rendering.',
    },
    synchronousMessageHandler: {
      samples: defaultMessages.length,
      p95Ms: messageHandlerP95Ms,
      maxMs: Math.max(...defaultMessages.map((s) => s.durationMs)),
      limitMs: 50,
      scope:
        'Synchronous time inside the assigned Worker onmessage handler only; excludes every continuation after await. This is not complete main-thread task duration.',
    },
    cancellation: {
      milliseconds: snapshot.cancelledAt - snapshot.cancelClickAt,
      limitMs: 200,
      frameSymbols: 4096,
      trials: 200,
      cellsPerFrame: 8,
      scope:
        'Actual cancel-button click to MutationObserver seeing cancelled status; storage completion is excluded.',
    },
    progress: {
      targetMs: 100,
      nonFinalVisibleGapsMs: nonFinalProgressGapsMs,
      minimumGapWithRenderJitterMs: 75,
      finalBatchMayArriveEarlier: true,
      scope:
        'Visible progress status commits, rather than claimed Worker emission timestamps; 25 ms render scheduling allowance.',
    },
    longTasks: {
      supported: snapshot.longTasksSupported,
      count: snapshot.longTasks.length,
      maxDurationMs: Math.max(
        0,
        ...snapshot.longTasks.map((s) => s.durationMs),
      ),
      entries: snapshot.longTasks,
      scope:
        'Chromium PerformanceObserver longtask diagnostics for the page; not an upper bound on total work or a substitute for full completion timing.',
    },
  }
  const output = resolve(
    import.meta.dirname,
    '../../output/v12-browser-performance.json',
  )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(result, null, 2), 'utf8')
  await testInfo.attach('v12-browser-performance', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  expect(result.completion.medianMs).toBeLessThanOrEqual(5000)
  expect(result.synchronousMessageHandler.p95Ms).toBeLessThan(50)
  expect(result.cancellation.milliseconds).toBeLessThanOrEqual(200)
  for (const gap of nonFinalProgressGapsMs)
    expect(gap).toBeGreaterThanOrEqual(75)
})
