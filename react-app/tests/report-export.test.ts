import assert from 'node:assert/strict'
import test from 'node:test'
import { renderReport, type ReportSnapshot } from '../src/lib/reportExport.js'

const snapshot: ReportSnapshot = {
  generatedAt: '2026-10-20T16:00:00.000Z',
  context: {
    experiment: 'BPSK',
    data: {
      bits: 32,
      seed: 42,
      ebN0Db: 0,
      noiseEnabled: true,
      errors: 2,
      ber: 0.0625,
    },
  },
  charts: [
    { title: '发送波形', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
  ],
  messages: [],
}

test('self-contained HTML preserves parameters, graph, time zone and theory', () => {
  const html = renderReport(snapshot, 'html')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /种子/)
  assert.match(html, /42/)
  assert.match(html, /0\.0625/)
  assert.match(html, /Asia\/Hong_Kong/)
  assert.match(html, /2026\/10\/21/)
  assert.match(html, /data:image\/svg\+xml;base64,PHN2Zy8\+/)
  assert.match(html, /@media print/)
  assert.doesNotMatch(html, /<script|<link|https?:\/\//)
})

test('HTML escapes hostile AI text and retains its old snapshot', () => {
  const html = renderReport(
    {
      ...snapshot,
      messages: [
        {
          role: 'user',
          content: '<img src=x onerror=alert(1)>',
          snapshot: '{"seed":41}',
        },
        { role: 'assistant', content: '</pre><script>alert(1)</script>' },
      ],
    },
    'html',
  )
  assert.doesNotMatch(html, /<script|<img src=x/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /41/)
  assert.match(html, /AI 解释/)
})

test('Markdown retains images and protects question text from HTML and fence injection', () => {
  const md = renderReport(
    {
      ...snapshot,
      messages: [
        { role: 'user', content: '```\n<script>bad</script>\n|伪造表格|' },
        { role: 'assistant', content: '回答' },
      ],
    },
    'md',
  )
  assert.match(md, /!\[发送波形\]\(data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(md, /<script>/)
  assert.match(md, /0\.0625/)
})

test('cancelled BER report retains actual run seed, zero upper bound and point count', () => {
  const report = renderReport(
    {
      ...snapshot,
      context: {
        experiment: 'BER',
        data: {
          modulation: 'BPSK',
          status: 'cancelled',
          run: { bits: 10000, seed: 42 },
          points: [
            {
              ebN0Db: 10,
              seed: 49,
              bits: 10000,
              errors: 0,
              ber: 0,
              theoretical: 0.000003872,
              interval: { kind: 'zero-upper', lower: 0, upper: 0.0002995 },
            },
          ],
        },
      },
    },
    'html',
  )
  assert.match(report, /已取消/)
  assert.match(report, /1\/8/)
  assert.match(report, /单侧95%上限/)
  assert.match(report, /0\.0002995/)
  assert.match(report, /49/)
})

test('noiseless experiments omit noisy-channel theory value', () => {
  const html = renderReport(
    {
      ...snapshot,
      context: {
        experiment: 'QPSK',
        data: { bits: 32, noiseEnabled: false, ebN0Db: 0, theoretical: null },
      },
    },
    'html',
  )
  assert.match(html, /已关闭噪声/)
  assert.doesNotMatch(html, /null|7\.865/)
})

test('report string remains unchanged after source data mutates', () => {
  const input = structuredClone(snapshot)
  const report = renderReport(input, 'html')
  input.context.data.seed = 900
  assert.equal(report, renderReport(snapshot, 'html'))
})

test('full input and decoded bits and QPSK samples are labelled separately', () => {
  const html = renderReport(
    {
      ...snapshot,
      context: {
        experiment: 'QPSK',
        data: {
          bits: 4,
          inputBits: '0011',
          decodedBits: '0111',
          noiseEnabled: true,
          samples: [{ index: 1, sent: '00', i: 1.2, q: -0.4, decoded: '01' }],
        },
      },
    },
    'html',
  )
  assert.match(html, /输入比特（完整）/)
  assert.match(html, /0111/)
  assert.match(html, /接收 I/)
  assert.match(html, /-0\.4/)
})
