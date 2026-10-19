import assert from 'node:assert/strict'
import test from 'node:test'
import { createRssProxyResponse } from '../server/rssProxyHandler.js'

test('returns a client error when the feed URL is absent', async () => {
  const response = await createRssProxyResponse(null)

  assert.deepEqual(response, {
    body: 'Missing "url" query parameter',
    contentType: 'text/plain',
    status: 400,
  })
})

test('returns RSS XML with a content type for successful fetches', async () => {
  const response = await createRssProxyResponse(
    'https://feed.example/rss.xml',
    {
      fetchPublicFeed: async () => ({ body: '<rss />', status: 200 }),
    },
  )

  assert.deepEqual(response, {
    body: '<rss />',
    contentType: 'application/xml; charset=utf-8',
    status: 200,
  })
})

test('does not expose unexpected upstream errors', async () => {
  const response = await createRssProxyResponse(
    'https://feed.example/rss.xml',
    {
      fetchPublicFeed: async () => {
        throw new Error('socket failed')
      },
    },
  )

  assert.deepEqual(response, {
    body: 'Failed to fetch feed.',
    contentType: 'text/plain',
    status: 502,
  })
})
