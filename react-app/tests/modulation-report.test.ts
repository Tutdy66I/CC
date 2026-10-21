import assert from 'node:assert/strict'
import test from 'node:test'
import { renderReport, type ReportSnapshot } from '../src/lib/reportExport.js'
import { simulateComparisonPoint } from '../src/lib/modulationComparison.js'
import { createTutorReply, validateTutorRequest } from '../server/aiTutor.js'

const base = { generatedAt: '2026-10-21T00:00:00Z', charts: [], messages: [] }
test('16QAM reports include its own theory, symbol labels and EVM normalization', () => {
  const snapshot: ReportSnapshot = {
    ...base,
    context: {
      experiment: '16QAM',
      data: {
        bits: 4,
        ebN0Db: 0,
        noiseEnabled: true,
        evmPercent: 10,
        samples: [{ i: 1, q: 1 }],
      },
    },
  }
  const html = renderReport(snapshot, 'html')
  assert.match(html, /0\.140981/)
  assert.match(html, /RMS EVM/)
  assert.match(html, /Es=4/)
  assert.match(html, /1 个符号/)
  assert.match(html, /实际发送信号归一化/)
})

test('partial comparison report only includes completed points and the immutable run', () => {
  const point = simulateComparisonPoint('16QAM', 0, 64, 0xffffffff)
  const snapshot: ReportSnapshot = {
    ...base,
    context: {
      experiment: 'COMPARISON',
      data: {
        status: 'cancelled',
        run: { bits: 64, seed: 0xffffffff },
        points: [point],
      },
    },
  }
  const html = renderReport(snapshot, 'html')
  assert.match(html, /已取消/)
  assert.match(html, /1\/30/)
  assert.match(html, /4294967295/)
  assert.match(html, /不提供置信带/)
  assert.match(html, /16QAM/)
  assert.doesNotMatch(html, /undefined|NaN/)
  assert.match(renderReport(snapshot, 'md'), /参考辅助 RMS EVM/)
})

test('tutor accepts 16QAM and complete comparison snapshots with bounded teaching context', async () => {
  const points = Array.from({ length: 10 }, (_, index) => [
    -4 + index * 2,
  ]).flatMap(([db]) =>
    ['BPSK', 'QPSK', '16QAM'].map((modulation) =>
      simulateComparisonPoint(
        modulation as 'BPSK' | 'QPSK' | '16QAM',
        db,
        64,
        42,
      ),
    ),
  )
  for (const experiment of ['16QAM', 'COMPARISON'] as const) {
    const body = {
      context: {
        experiment,
        data: { points, run: { bits: 64, seed: 42 }, status: 'done' },
      },
      messages: [{ role: 'user', content: '解释 BER 与 EVM' }],
    }
    assert.equal(validateTutorRequest(body).context.experiment, experiment)
    const result = await createTutorReply(
      body,
      {
        AI_BASE_URL: 'http://localhost',
        AI_MODEL: 'fixture',
        AI_API_KEY: 'synthetic',
      },
      async (_url, options) => {
        const payload = JSON.parse(String(options?.body))
        assert.match(payload.messages[0].content, /16QAM/)
        assert.match(payload.messages[0].content, /EVM RMS/)
        return Response.json({
          choices: [
            { message: { content: '参考辅助测量，不能直接等同 BER。' } },
          ],
        })
      },
    )
    assert.equal(result.status, 200)
  }
})
