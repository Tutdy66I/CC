import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchFeed } from '../src/lib/rss.js'

// A local, abort-aware transport: no real network or DOM parser is needed.
function pendingFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal
    const timer = setTimeout(
      () => reject(new Error('deadline was not applied')),
      100,
    )
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

const request = fetchFeed

test('RSS deadline aborts a stalled request with a timeout message', async (t) => {
  t.mock.method(globalThis, 'fetch', pendingFetch)
  await assert.rejects(
    request('https://feed.example/rss.xml', undefined, 5),
    /timed out after 0\.005s/,
  )
})

test('RSS caller cancellation remains distinguishable from timeout', async (t) => {
  t.mock.method(globalThis, 'fetch', pendingFetch)
  const controller = new AbortController()
  const reason = new DOMException('User cancelled', 'AbortError')
  const result = request('https://feed.example/rss.xml', controller.signal, 50)
  controller.abort(reason)
  await assert.rejects(result, (error) => error === reason)
})

test('RSS respects a caller signal that was already aborted', async (t) => {
  t.mock.method(globalThis, 'fetch', pendingFetch)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    request('https://feed.example/rss.xml', controller.signal, 50),
    { name: 'AbortError' },
  )
})

test('RSS preserves HTTP errors rather than reporting a timeout', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('Unavailable', { status: 503, statusText: 'Unavailable' }),
  )
  await assert.rejects(
    request('https://feed.example/rss.xml', undefined, 50),
    /503 Unavailable/,
  )
})

test('RSS deadline also covers a response body that stalls after headers', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: string | URL | Request, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(init.signal?.reason),
              { once: true },
            )
          },
        }),
      ),
  )
  await assert.rejects(
    request('https://feed.example/rss.xml', undefined, 5),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('timed out') &&
      error.cause instanceof DOMException,
  )
})
