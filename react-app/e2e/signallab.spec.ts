import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { simulateBpsk } from '../src/lib/signallab.js'

test.beforeEach(async ({ page }) => {
  // Tests may only contact their own production server. AI success paths use route fixtures.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.origin === 'http://127.0.0.1:4175'
      ? route.continue()
      : route.abort()
  })
  await page.goto('/#/signallab')
  await expect(
    page.getByRole('heading', { name: 'SignalLab AI', exact: true }),
  ).toBeVisible()
})

test('BPSK and QPSK validate inputs, restore noiseless bits and reproduce seeded samples', async ({
  page,
}) => {
  const bits = page.getByLabel('输入比特流', { exact: true })
  await bits.fill('012')
  await expect(page.getByRole('alert')).toContainText('请输入 0 和 1')
  await bits.fill('0101')
  await page.getByLabel('随机种子', { exact: true }).fill('4294967295')
  const samples = page
    .getByRole('img', { name: /^接收判决采样/ })
    .locator('polyline')
  const original = await samples.getAttribute('points')
  await page.getByLabel('随机种子', { exact: true }).fill('0')
  await expect(samples).not.toHaveAttribute('points', original!)
  await page.getByLabel('随机种子', { exact: true }).fill('4294967295')
  await expect(samples).toHaveAttribute('points', original!)
  await page.getByLabel('启用 AWGN 噪声', { exact: false }).uncheck()
  await expect(page.getByRole('slider', { name: /^Eb\/N0/ })).toBeDisabled()
  await expect(page.getByLabel('恢复比特', { exact: true })).toHaveText('0101')
  await expect(
    page.getByRole('region', { name: '实验结果', exact: true }).locator('dd'),
  ).toHaveText(['4', '0', '0.000'])

  await page.getByLabel('QPSK 输入比特流', { exact: true }).fill('010')
  await expect(page.getByRole('alert')).toContainText('偶数长度')
  await page.getByLabel('QPSK 输入比特流', { exact: true }).fill('00011110')
  await page.getByLabel('启用 QPSK AWGN 噪声', { exact: true }).uncheck()
  await expect(page.getByLabel('QPSK 恢复比特', { exact: true })).toHaveText(
    '00011110',
  )
  await expect(page.getByRole('img', { name: /^QPSK 星座图/ })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('real bundled Worker scans eight points, wraps seeds and reproduces array-channel results', async ({
  page,
}) => {
  const sweep = page.getByRole('region', { name: 'BER 曲线实验', exact: true })
  await page
    .getByRole('combobox', { name: '每点比特数', exact: true })
    .selectOption('10000')
  await page.getByLabel('扫描基础种子').fill('4294967295')
  await sweep.getByRole('button', { name: '开始 BER 扫描' }).click()
  await expect(sweep.getByRole('status').first()).toHaveText('扫描完成：8/8 点')
  const rows = sweep.locator('tbody tr')
  await expect(rows).toHaveCount(8)
  const bits = Array.from({ length: 10000 }, (_, i) => i % 2)
  for (const [index, db] of [-4, -2, 0, 2, 4, 6, 8, 10].entries()) {
    const seed = (0xffffffff + index) >>> 0
    await expect(rows.nth(index).locator('td').nth(0)).toHaveText(String(seed))
    await expect(rows.nth(index).locator('td').nth(2)).toHaveText(
      String(simulateBpsk(bits, db, seed).errors),
    )
  }
  const original = await rows.allTextContents()
  await sweep.getByRole('button', { name: '开始 BER 扫描' }).click()
  await expect(sweep.getByRole('status').first()).toHaveText('扫描完成：8/8 点')
  expect(await rows.allTextContents()).toEqual(original)
})

test('scan can be cancelled while its real Worker is waiting to start', async ({
  page,
}) => {
  // Delay only main-thread dispatch, avoiding a timing race with a fast eight-point scan.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message: unknown) {
      window.addEventListener(
        'e2e-dispatch-worker',
        () => post.call(this, message),
        { once: true },
      )
    }
  })
  const sweep = page.getByRole('region', { name: 'BER 曲线实验', exact: true })
  await sweep.getByRole('button', { name: '开始 BER 扫描' }).click()
  await sweep.getByRole('button', { name: '取消扫描' }).click()
  await expect(sweep.getByRole('status').first()).toContainText(
    '已取消：保留 0/8',
  )
  await expect(
    page.getByRole('combobox', { name: '每点比特数', exact: true }),
  ).toBeEnabled()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('e2e-dispatch-worker')),
  )
  await expect(sweep.getByRole('status').first()).toContainText(
    '已取消：保留 0/8',
  )
})

test('HTML and Markdown downloads contain offline charts and current experimental data', async ({
  page,
}) => {
  await page.getByLabel('输入比特流', { exact: true }).fill('0101')
  const group = page.getByRole('group', { name: 'BPSK报告导出', exact: true })
  for (const [label, extension] of [
    ['HTML', 'html'],
    ['Markdown', 'md'],
  ]) {
    const downloadEvent = page.waitForEvent('download')
    await group.getByRole('button', { name: `导出 ${label} 报告` }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^SignalLab-BPSK-.*\\.${extension}$`),
    )
    const report = await readFile((await download.path())!, 'utf8')
    expect(report).toContain('0101')
    expect(report).toContain('data:image/svg+xml;base64,')
    expect(report).toContain('零误码不代表真实 BER 为零')
    expect(report).toContain(
      extension === 'md' ? 'Asia/Hong\\_Kong' : 'Asia/Hong_Kong',
    )
  }
})

test('unconfigured production tutor returns explicit 503 without contacting a provider', async ({
  page,
}) => {
  const tutor = page.locator('details.ai-tutor').first()
  await tutor.locator('summary').first().click()
  await tutor.getByLabel('向实验助教提问').fill('解释当前结果')
  const responseEvent = page.waitForResponse('**/api/ai-tutor')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  expect((await responseEvent).status()).toBe(503)
  await expect(tutor.getByRole('alert')).toContainText('尚未配置')
})

test('tutor retains old snapshots, sends updated seed and renders provider text safely', async ({
  page,
}) => {
  const requests: {
    context: { data: { seed: number } }
    messages: { content: string }[]
  }[] = []
  await page.route('**/api/ai-tutor', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      json: { answer: '<script>window.injected = true</script> 有限样本回答' },
    })
  })
  const tutor = page.locator('details.ai-tutor').first()
  await tutor.locator('summary').first().click()
  await tutor.getByLabel('向实验助教提问').fill('第一问')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(tutor.getByRole('log')).toContainText('<script>')
  await page.getByLabel('随机种子', { exact: true }).fill('43')
  await tutor.getByLabel('向实验助教提问').fill('继续解释')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(tutor.getByRole('log').getByRole('article')).toHaveCount(4)
  expect(requests.map((request) => request.context.data.seed)).toEqual([42, 43])
  expect(requests[1].messages.length).toBe(3)
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
  const snapshots = tutor.getByRole('log').locator('pre')
  await expect(snapshots.nth(0)).toContainText('"seed": 42')
  await expect(snapshots.nth(1)).toContainText('"seed": 43')
  await tutor.getByRole('button', { name: '清空对话' }).click()
  await expect(tutor.getByRole('log')).toBeEmpty()
})

test('cancelled tutor ignores a late reply and preserves an empty conversation', async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  await page.route('**/api/ai-tutor', async (route) => {
    entered()
    await held
    await route.fulfill({ json: { answer: '迟到回答' } }).catch(() => {})
  })
  const tutor = page.locator('details.ai-tutor').first()
  await tutor.locator('summary').first().click()
  await tutor.getByLabel('向实验助教提问').fill('等待回答')
  await tutor.getByRole('button', { name: '发送问题', exact: true }).click()
  await started
  await tutor.getByRole('button', { name: '取消回答' }).click()
  release()
  await expect(tutor.getByRole('status')).toContainText('取消')
  await expect(tutor.getByRole('log')).toBeEmpty()
})
