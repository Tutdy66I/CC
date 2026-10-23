import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_FEEDS,
  MAX_ITEMS_PER_FEED,
  FEED_CACHE_TTL_MS,
  loadFeedItems,
  loadFeeds,
  saveFeedItems,
  saveFeeds,
  type FeedItem,
  type FeedMeta,
} from '../src/lib/rss.js'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function feed(index: number): FeedMeta {
  return {
    url: `https://feed-${index}.example/rss.xml`,
    title: `Feed ${index}`,
    link: `https://feed-${index}.example`,
    description: '',
    lastFetched: '2026-10-19T00:00:00.000Z',
  }
}

function item(index: number): FeedItem {
  return {
    id: String(index),
    title: `Item ${index}`,
    link: `https://feed.example/posts/${index}`,
    description: '',
    pubDate: '',
    feedUrl: 'https://feed.example/rss.xml',
  }
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
})

test('keeps the most recent feeds within the cache limit', () => {
  saveFeeds(Array.from({ length: MAX_FEEDS + 1 }, (_, index) => feed(index)))

  assert.deepEqual(
    loadFeeds().map((entry) => entry.url),
    Array.from(
      { length: MAX_FEEDS },
      (_, index) => `https://feed-${index + 1}.example/rss.xml`,
    ),
  )
})

test('keeps the newest items within the per-feed cache limit', () => {
  saveFeedItems(
    'https://feed.example/rss.xml',
    Array.from({ length: MAX_ITEMS_PER_FEED + 1 }, (_, index) => item(index)),
  )

  assert.deepEqual(
    loadFeedItems('https://feed.example/rss.xml').map((entry) => entry.id),
    Array.from({ length: MAX_ITEMS_PER_FEED }, (_, index) => String(index)),
  )
})

test('expires feed items after the cache TTL', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 23) })
  const url = 'https://feed.example/rss.xml'
  const now = Date.now()
  saveFeedItems(url, [item(1)])

  assert.deepEqual(loadFeedItems(url, now + FEED_CACHE_TTL_MS), [item(1)])
  assert.deepEqual(loadFeedItems(url, now + FEED_CACHE_TTL_MS + 1), [])
})
