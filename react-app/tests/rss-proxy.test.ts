import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPublicFeed, validateFeedUrl } from '../server/rssProxy.js'

test('rejects loopback feed URLs before making a request', async () => {
  await assert.rejects(
    validateFeedUrl('http://127.0.0.1/feed.xml'),
    /public host/,
  )
})

test('rejects hostnames that resolve to private addresses', async () => {
  await assert.rejects(
    validateFeedUrl('https://feed.example/rss.xml', async () => [
      { address: '192.168.1.20', family: 4 },
    ]),
    /public addresses only/,
  )
})

test('revalidates redirect destinations before following them', async () => {
  const requestedUrls: string[] = []

  await assert.rejects(
    fetchPublicFeed('https://feed.example/rss.xml', {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async ({ url }) => {
        requestedUrls.push(url.href)
        return {
          body: '',
          location: 'http://127.0.0.1/private.xml',
          status: 302,
        }
      },
    }),
    /public host/,
  )
  assert.deepEqual(requestedUrls, ['https://feed.example/rss.xml'])
})

test('follows a redirect only after validating the public destination', async () => {
  const resolvedHosts: string[] = []
  const requestedUrls: string[] = []

  const result = await fetchPublicFeed('https://feed.example/rss.xml', {
    resolveHost: async (hostname) => {
      resolvedHosts.push(hostname)
      return [{ address: '93.184.216.34', family: 4 }]
    },
    request: async ({ url }) => {
      requestedUrls.push(url.href)
      return requestedUrls.length === 1
        ? { body: '', location: '/latest.xml', status: 302 }
        : { body: '<rss />', status: 200 }
    },
  })

  assert.deepEqual(resolvedHosts, ['feed.example', 'feed.example'])
  assert.deepEqual(requestedUrls, [
    'https://feed.example/rss.xml',
    'https://feed.example/latest.xml',
  ])
  assert.deepEqual(result, { body: '<rss />', status: 200 })
})
