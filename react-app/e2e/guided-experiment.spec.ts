import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('cancelled AI and simulation cannot create results, and both can be retried', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const section = page.getByRole('region', {
    name: 'AI 引导式实验',
    exact: true,
  })
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/ai-tutor', async (route) => {
    await gate
    await route.fulfill({ json: { answer: 'late response' } }).catch(() => {})
  })
  await section
    .getByRole('button', { name: 'AI 建议参数', exact: true })
    .click()
  await section.getByRole('button', { name: '取消引导 AI 请求' }).click()
  release()
  await expect(section.getByRole('status')).toContainText('AI 请求已取消')
  await expect(section.locator('tbody tr')).toHaveCount(0)
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage() {}
    }
  })
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(
    section.getByLabel('引导基础种子', { exact: true }),
  ).toBeDisabled()
  await section
    .getByRole('button', { name: '取消引导实验', exact: true })
    .click()
  await expect(section.getByRole('status')).toContainText('实验已取消')
  await expect(section.locator('tbody tr')).toHaveCount(0)
  await page.reload()
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('status')).toContainText('实验完成')
})

test('all templates keep independent history and failed AI analysis preserves real results', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const section = page.getByRole('region', {
    name: 'AI 引导式实验',
    exact: true,
  })
  for (const template of ['equivalence', 'qam', 'sampling']) {
    await section.getByLabel('实验目标', { exact: true }).selectOption(template)
    await section
      .getByRole('button', { name: '确认方案并运行', exact: true })
      .click()
    await expect(section.getByRole('status')).toContainText('实验完成')
    await expect(section.locator('tbody tr')).toHaveCount(
      template === 'qam' ? 3 : 6,
    )
  }
  await expect(section.locator('#guided-history option')).toHaveCount(3)
  await page.route('**/api/ai-tutor', (route) =>
    route.fulfill({ status: 503, json: { error: '测试：模型未配置' } }),
  )
  await section
    .getByRole('button', { name: 'AI 分析本次结果', exact: true })
    .click()
  await expect(section.getByRole('alert')).toContainText('模型未配置')
  await expect(section.locator('tbody tr')).toHaveCount(6)
  await page.reload()
  await expect(section.locator('#guided-history option')).toHaveCount(3)
})

test('guided flow requires confirmation, runs real Worker, persists snapshots and binds AI analysis', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const section = page.getByRole('region', {
    name: 'AI 引导式实验',
    exact: true,
  })
  await expect(section.getByRole('status')).toContainText('等待确认')
  await expect(section.locator('tbody tr')).toHaveCount(0)
  await page.route('**/api/ai-tutor', async (route) => {
    const body = route.request().postDataJSON()
    if (body.context.data.stage === 'plan') {
      await route.fulfill({
        json: {
          answer: JSON.stringify({
            ...body.context.data.plan,
            dbValues: [0, 14],
            rationale: '对照中等信噪比与稀有误码。',
          }),
        },
      })
    } else {
      expect(body.context.data.record.plan.seed).toBe(42)
      expect(body.context.data.record.rows).toHaveLength(4)
      await route.fulfill({
        json: {
          answer:
            '本次实测来自已完成快照；零误码仍有正上界。下一轮增加样本量。',
        },
      })
    }
  })
  await section
    .getByRole('button', { name: 'AI 建议参数', exact: true })
    .click()
  await expect(section.getByText('对照中等信噪比与稀有误码。')).toBeVisible()
  await expect(section.locator('tbody tr')).toHaveCount(0)
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('status')).toContainText('实验完成')
  await expect(section.locator('tbody tr')).toHaveCount(4)
  await section.getByLabel('引导基础种子', { exact: true }).fill('7')
  await section
    .getByRole('button', { name: 'AI 分析本次结果', exact: true })
    .click()
  await expect(section.getByText(/本次实测来自已完成快照/)).toBeVisible()
  const downloading = page.waitForEvent('download')
  await section.getByRole('button', { name: '导出实验记录 JSON' }).click()
  const download = await downloading
  const record = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(record.plan.seed).toBe(42)
  expect(record.rows).toHaveLength(4)
  expect(record.analysis).toContain('零误码')
  await page.reload()
  await expect(section.locator('tbody tr')).toHaveCount(4)
  await expect(section.getByText(/本次实测来自已完成快照/)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('invalid AI plan cannot change parameters or execute; cancellation and worker failure recover', async ({
  page,
}) => {
  await page.goto('/#/signallab')
  const section = page.getByRole('region', {
    name: 'AI 引导式实验',
    exact: true,
  })
  await page.route('**/api/ai-tutor', (route) =>
    route.fulfill({ json: { answer: '{"bits":999999999}' } }),
  )
  await section
    .getByRole('button', { name: 'AI 建议参数', exact: true })
    .click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.locator('tbody tr')).toHaveCount(0)
  await expect(section.getByLabel('引导每次比特数')).toHaveValue('16384')
  await section.getByLabel('引导基础种子', { exact: true }).fill('')
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('alert')).toContainText('基础种子')
  await section.getByLabel('引导基础种子', { exact: true }).fill('42')
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage() {
        setTimeout(
          () =>
            this.dispatchEvent(
              new ErrorEvent('error', {
                message: 'test failure',
                cancelable: true,
              }),
            ),
          50,
        )
      }
    }
  })
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('alert')).toContainText('后台计算失败')
  await expect(
    section.getByRole('button', { name: 'AI 分析本次结果', exact: true }),
  ).toBeDisabled()
  await page.reload()
  await section
    .getByRole('button', { name: '确认方案并运行', exact: true })
    .click()
  await expect(section.getByRole('status')).toContainText('实验完成')
})
