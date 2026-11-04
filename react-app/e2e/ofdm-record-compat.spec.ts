import { expect, test } from '@playwright/test'
import {
  defaultOfdmCombPlan,
  freezeOfdmCombPlan,
  ofdmHash,
} from '../src/lib/ofdmCombProtocol.js'
import { simulateOfdmCombTrial } from '../src/lib/ofdmCombResearch.js'
import { makeOfdmCombRecord } from '../src/lib/ofdmCombResearchRecord.js'
import { validateOriginal } from '../src/ofdm-record-compat/v1/reader.js'
import { readFile } from 'node:fs/promises'

test('compatibility import preserves the original across save and reload', async ({
  page,
}) => {
  const p = {
    ...defaultOfdmCombPlan(),
    fftSize: 64,
    cp: 8,
    dataSymbols: 2,
    trials: 2,
    activeBins: [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6],
    pilotLayouts: [
      [-6, -2, 2, 6],
      [-6, -3, 3, 6],
    ],
    channels: ['awgn' as const],
    ebN0Db: [16],
  }
  const f = await freezeOfdmCombPlan(p)
  const record = await makeOfdmCombRecord(
    f,
    [await simulateOfdmCombTrial(p, 0), await simulateOfdmCombTrial(p, 1)],
    { sourceFingerprint: 'a'.repeat(64), runtimeFingerprint: 'b'.repeat(64) },
  )
  const { integrityHash: _ignored, ...payload } = record
  void _ignored
  record.integrityHash = await ofdmHash(payload)
  const original = Buffer.from(JSON.stringify(record))
  await page.goto('/#/signallab')
  await page.getByRole('button', { name: 'OFDM 兼容记录', exact: true }).click()
  const section = page.getByRole('region', { name: 'OFDM 兼容记录' })
  await section.getByLabel('选择原始 OFDM JSON').setInputFiles({
    name: 'synthetic.json',
    mimeType: 'application/json',
    buffer: original,
  })
  await expect(section.getByRole('status')).toContainText('记录验证通过')
  await section.getByRole('button', { name: '保存原件', exact: true }).click()
  await expect(section.getByRole('status')).toContainText('原件已保存')
  await page.reload()
  await page.getByRole('button', { name: 'OFDM 兼容记录', exact: true }).click()
  await section.getByRole('button', { name: '验证并查看' }).click()
  await expect(section.getByRole('status')).toContainText('已重新验证')
  const download = page.waitForEvent('download')
  await section.getByRole('button', { name: '导出原件', exact: true }).click()
  expect(await readFile(await (await download).path())).toEqual(original)
  record.integrityHash = '0'.repeat(64)
  await section.getByLabel('选择原始 OFDM JSON').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(record)),
  })
  await expect(section.getByRole('alert')).toContainText('哈希不匹配')
  await section.getByRole('button', { name: '验证并查看' }).click()
  await expect(section.getByRole('status')).toContainText('已重新验证')
  const edits: Array<(r: typeof record) => void> = [
    (r) => {
      r.trials[0].index = 1
    },
    (r) => {
      r.trials[0].cells[0].methods['ideal-zf'].errors += 1
    },
    (r) => {
      r.protocolHash = '0'.repeat(64)
    },
    (r) => {
      r.summary[0].bits += 1
    },
    (r) => {
      r.summary[0].idealTheoryBer = 0
    },
  ]
  for (const edit of edits) {
    const tampered = JSON.parse(original.toString()) as typeof record
    edit(tampered)
    const { integrityHash: ignored, ...changedPayload } = tampered
    void ignored
    tampered.integrityHash = await ofdmHash(changedPayload)
    await section
      .getByLabel('选择原始 OFDM JSON')
      .setInputFiles({
        name: 'valid.json',
        mimeType: 'application/json',
        buffer: original,
      })
    await expect(section.getByRole('status')).toContainText('记录验证通过')
    await section
      .getByLabel('选择原始 OFDM JSON')
      .setInputFiles({
        name: 'tampered.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(tampered)),
      })
    await expect(section.getByRole('alert')).toBeVisible()
  }
})

test('real nonempty OFDM checkpoint resumes its frozen prefix', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('signallab-ofdm-mode', 'comb'),
  )
  await page.goto('/#/signallab')
  const r = page.getByRole('region', {
    name: 'OFDM 梳状导频与插值',
    exact: true,
  })
  await r.getByLabel('OFDM 试验帧数').fill('30')
  await r
    .getByRole('button', { name: '冻结 OFDM 协议并运行', exact: true })
    .click()
  await expect(r.getByRole('status')).toContainText(
    /计算中：(?:[1-9]|[12][0-9])\/30 帧/,
  )
  await r.getByRole('button', { name: '取消 OFDM 计算', exact: true }).click()
  await expect(r.getByRole('status')).toContainText('已取消')
  const cp = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('signallab-ofdm-comb-v13')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise<{
        checkpoint: { trials: unknown[]; plan: unknown; protocolHash: string }
      }>((resolve, reject) => {
        const tx = db.transaction('state', 'readonly'),
          req = tx.objectStore('state').get('current')
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
  expect(cp.checkpoint.trials.length).toBeGreaterThan(0)
  expect(cp.checkpoint.trials.length).toBeLessThan(30)
  await page.reload()
  await expect(r.getByRole('status')).toContainText('检查点')
  await r.getByLabel('OFDM CP 长度').fill('0')
  await r.getByRole('button', { name: '继续 OFDM 检查点', exact: true }).click()
  await expect(r.getByRole('status')).toContainText('已保存本地')
  const event = page.waitForEvent('download')
  await r.getByRole('button', { name: '导出 OFDM JSON', exact: true }).click()
  const bytes = await readFile(await (await event).path())
  const result = await validateOriginal(bytes)
  expect(result.record.trials).toHaveLength(30)
  expect(result.record.trials.slice(0, cp.checkpoint.trials.length)).toEqual(
    cp.checkpoint.trials,
  )
  expect(result.record.plan).toEqual(cp.checkpoint.plan)
  expect(result.record.protocolHash).toBe(cp.checkpoint.protocolHash)
})
