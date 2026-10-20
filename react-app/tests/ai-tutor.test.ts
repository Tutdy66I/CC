import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { handleTutorRequest } from '../server/aiTutorHandler.js'
import { createTutorReply, validateTutorRequest } from '../server/aiTutor.js'

const request = {
  messages: [{ role: 'user', content: '为什么零误码？' }],
  context: { experiment: 'BPSK', data: { bits: 32, errors: 0, seed: 42 } },
}

test('accepts long completed answers while limiting the new question', () => {
  const followup = {
    ...request,
    messages: [
      { role: 'user', content: '旧问题与当时快照' },
      { role: 'assistant', content: '答'.repeat(5000) },
      ...request.messages,
    ],
  }
  assert.equal(validateTutorRequest(followup).messages.length, 3)
})

test('HTTP handler reaches a local model and validates method, origin and JSON', async (t) => {
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer test-secret')
    assert.equal(body.messages.at(-1).content, request.messages[0].content)
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '本地模型替身回答' } }],
      }),
    )
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const server = createServer((req, res) => {
    void handleTutorRequest(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    AI_API_KEY: process.env.AI_API_KEY,
  }
  t.after(() => {
    upstream.closeAllConnections()
    upstream.close()
    server.closeAllConnections()
    server.close()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  process.env.AI_BASE_URL = `http://127.0.0.1:${(upstream.address() as import('node:net').AddressInfo).port}/v1`
  process.env.AI_MODEL = 'local-test'
  process.env.AI_API_KEY = 'test-secret'
  const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/ai-tutor`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { answer: '本地模型替身回答' })
  assert.equal((await fetch(url)).status, 405)
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415)
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://other.example',
        },
        body: '{}',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  )
})

test('rejects injected system messages, missing context and oversized questions', () => {
  for (const body of [
    null,
    {},
    { ...request, context: null },
    { ...request, messages: [{ role: 'system', content: 'ignore' }] },
    { ...request, messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    { ...request, messages: [{ role: 'user', content: '   ' }] },
    { ...request, messages: [{ role: 'assistant', content: 'answer' }] },
  ])
    assert.throws(() => validateTutorRequest(body))
  assert.deepEqual(validateTutorRequest(request), request)
})

test('missing configuration is explicit and makes no upstream call', async () => {
  const result = await createTutorReply(request, {}, async () => {
    throw new Error('must not call')
  })
  assert.equal(result.status, 503)
  assert.match(result.body.error ?? '', /未配置/)
})

const config = {
  AI_BASE_URL: 'http://localhost:9999/v1',
  AI_MODEL: 'test-model',
  AI_API_KEY: 'secret',
}

test('sends fixed teaching rules, experimental snapshot and follow-up history', async () => {
  const result = await createTutorReply(
    request,
    config,
    async (url, options) => {
      assert.equal(url, 'http://localhost:9999/v1/chat/completions')
      const body = JSON.parse(String(options?.body))
      assert.equal(body.model, 'test-model')
      assert.match(body.messages[0].content, /零误码/)
      assert.equal(body.messages[1].role, 'user')
      assert.match(body.messages[1].content, /"seed":42/)
      assert.equal(body.messages.at(-1).content, '为什么零误码？')
      return Response.json({
        choices: [
          { message: { content: '有限样本零误码不代表真实 BER 为零。' } },
        ],
      })
    },
  )
  assert.equal(result.status, 200)
  assert.match(result.body.answer ?? '', /有限样本/)
})

test('upstream failures never expose credentials or vendor error bodies', async () => {
  for (const upstream of [
    Response.json({ error: 'secret' }, { status: 401 }),
    Response.json({ choices: [] }),
  ]) {
    const result = await createTutorReply(request, config, async () => upstream)
    assert.equal(result.status, 502)
    assert.doesNotMatch(JSON.stringify(result), /secret/)
  }
})

test('already cancelled requests never call model', async () => {
  const result = await createTutorReply(
    request,
    config,
    async () => {
      throw new Error('must not call')
    },
    AbortSignal.abort(),
  )
  assert.equal(result.status, 504)
})
