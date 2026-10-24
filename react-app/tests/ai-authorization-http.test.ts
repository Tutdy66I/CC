import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleTutorRequest } from '../server/aiTutorHandler.js'

test('configured HTTP tutor refuses anonymous access before any provider call', async (t) => {
  let calls = 0
  const provider = createServer((_req, res) => {
    calls++
    res.end('{}')
  })
  const server = createServer((req, res) => {
    void handleTutorRequest(req, res)
  })
  const previous = { ...process.env }
  t.after(() => {
    for (const key of [
      'AI_ACCESS_MODE',
      'AI_API_KEY',
      'AI_BASE_URL',
      'AI_MODEL',
    ]) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    server.closeAllConnections()
    server.close()
    provider.closeAllConnections()
    provider.close()
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  delete process.env.AI_ACCESS_MODE
  process.env.AI_API_KEY = 'synthetic-key'
  process.env.AI_MODEL = 'fixture'
  process.env.AI_BASE_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
  const response = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai-tutor`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        context: { experiment: 'BPSK', data: {} },
      }),
    },
  )
  assert.equal(response.status, 401)
  assert.equal(calls, 0)
})
