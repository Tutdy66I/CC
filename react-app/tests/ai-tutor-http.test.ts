import assert from 'node:assert/strict'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { handleTutorRequest } from '../server/aiTutorHandler.js'

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const payload = (question = '解释当前实验') => ({
  messages: [{ role: 'user', content: question }],
  context: { experiment: 'BPSK', data: { seed: 42 } },
})

test(
  'HTTP size, read deadline, concurrency, disconnect and fixed-window rate limits',
  { timeout: 25000 },
  async (t) => {
    let calls = 0
    let onHold = () => {}
    let onDisconnect = () => {}
    const held: import('node:http').ServerResponse[] = []
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      calls++
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const question = body.messages.at(-1).content
      res.setHeader('Content-Type', 'application/json')
      if (question === 'hold' || question === 'disconnect') {
        held.push(res)
        res.on('close', onDisconnect)
        onHold()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({ choices: [{ message: { content: '本地测试回答' } }] }),
      )
    })
    const server = createServer((req, res) => {
      void handleTutorRequest(req, res)
    })
    const previous = Object.fromEntries(
      ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_ACCESS_MODE'].map((key) => [
        key,
        process.env[key],
      ]),
    )
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      for (const item of [server, upstream]) {
        item.closeAllConnections()
        item.close()
      }
    })
    process.env.AI_BASE_URL = await listen(upstream)
    process.env.AI_MODEL = 'fixture'
    process.env.AI_ACCESS_MODE = 'local'
    process.env.AI_API_KEY = 'synthetic-http-test-key'
    const url = `${await listen(server)}/api/ai-tutor`
    const send = (question?: string, signal?: AbortSignal) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(question)),
        signal,
      })

    await t.test(
      'rejects oversized UTF-8 bodies before contacting the provider',
      async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: '中'.repeat(22000) }),
        })
        assert.equal(response.status, 413)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(calls, 0)
      },
    )

    await t.test(
      'slow incomplete body receives 408 and releases the slot',
      async () => {
        const status = await new Promise<number | undefined>(
          (resolve, reject) => {
            const req = httpRequest(
              url,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': '100',
                },
              },
              (res) => {
                res.resume()
                res.on('end', () => {
                  resolve(res.statusCode)
                  req.destroy()
                })
              },
            )
            req.on('error', reject)
            req.write('{')
          },
        )
        assert.equal(status, 408)
        assert.equal(calls, 0)
        assert.equal((await send()).status, 200)
      },
    )

    await t.test(
      'third concurrent request is rejected and slots recover',
      async () => {
        let notify!: () => void
        const ready = new Promise<void>((resolve) => {
          notify = resolve
        })
        onHold = () => {
          if (held.length === 2) notify()
        }
        const pending = [send('hold'), send('hold')]
        await ready
        const rejected = await send()
        assert.equal(rejected.status, 429)
        assert.equal(rejected.headers.get('retry-after'), '60')
        for (const res of held.splice(0))
          res.end(
            JSON.stringify({ choices: [{ message: { content: '释放' } }] }),
          )
        for (const response of await Promise.all(pending))
          assert.equal(response.status, 200)
      },
    )

    await t.test(
      'client disconnect cancels the real upstream HTTP request',
      async () => {
        let notify!: () => void
        const ready = new Promise<void>((resolve) => {
          notify = resolve
        })
        onHold = notify
        let closed!: () => void
        const disconnected = new Promise<void>((resolve) => {
          closed = resolve
        })
        onDisconnect = closed
        const controller = new AbortController()
        const result = send('disconnect', controller.signal)
        const rejected = assert.rejects(result, { name: 'AbortError' })
        await ready
        controller.abort()
        await rejected
        await disconnected
        held.length = 0
      },
    )

    await t.test(
      'eleventh admitted request is rate limited even with forged forwarding headers',
      async () => {
        // Six admitted so far: oversized, slow body, success, two held, disconnect.
        for (let index = 0; index < 4; index++)
          assert.equal((await send()).status, 200)
        const before = calls
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.99',
          },
          body: JSON.stringify(payload()),
        })
        assert.equal(response.status, 429)
        assert.equal(calls, before)
      },
    )
  },
)
