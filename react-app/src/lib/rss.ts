/** RSS reader — fetch, parse, and cache external feeds */

export interface FeedMeta {
  url: string
  title: string
  link: string
  description: string
  lastFetched: string // ISO timestamp
}

export interface FeedItem {
  id: string
  title: string
  link: string
  description: string
  pubDate: string
  feedUrl: string
}

export interface FeedData {
  meta: FeedMeta
  items: FeedItem[]
}

/* ---- DOM-based XML parsing (no extra deps) ---- */

type Node = Element | Document

function* children(parent: Node | null, tag: string): Generator<Element> {
  if (!parent) return
  const list = parent.getElementsByTagName(tag)
  for (let i = 0; i < list.length; i++) yield list[i]!
}

function first(el: Node | null, tag: string): Element | null {
  return el?.getElementsByTagName(tag)?.[0] ?? null
}

function text(el: Node | null, tag: string): string {
  return first(el, tag)?.textContent?.trim() ?? ''
}

function parseRSS2(doc: Document): FeedData {
  const channel = first(doc, 'channel')!

  const title = text(channel, 'title')
  const link = text(channel, 'link')
  const description = text(channel, 'description')

  const items: FeedItem[] = []
  for (const it of children(channel, 'item')) {
    const itemTitle = text(it, 'title')
    const itemLink = text(it, 'link')
    items.push({
      id: itemLink || itemTitle || crypto.randomUUID(),
      title: itemTitle,
      link: itemLink,
      description: text(it, 'description'),
      pubDate: text(it, 'pubDate'),
      feedUrl: '',
    })
  }

  return {
    meta: {
      url: '',
      title,
      link,
      description,
      lastFetched: new Date().toISOString(),
    },
    items,
  }
}

function parseAtom(doc: Document): FeedData {
  const feed = first(doc, 'feed')!

  const titleEl = first(feed, 'title')
  const linkEl = feed.querySelector('link[rel="alternate"]') as Element | null
  const subtitle = first(feed, 'subtitle')

  const title = titleEl?.textContent?.trim() ?? ''
  const link = (linkEl?.getAttribute('href') ?? '') || text(feed, 'link')
  const description = subtitle?.textContent?.trim() ?? ''

  const items: FeedItem[] = []
  for (const it of children(feed, 'entry')) {
    const entryTitle = text(it, 'title')
    const entryLink =
      (it.querySelector('link[rel="alternate"]')?.getAttribute('href') ?? '') ||
      text(it, 'link')
    items.push({
      id:
        it.getElementsByTagName('id')?.[0]?.textContent?.trim() ||
        entryLink ||
        entryTitle ||
        crypto.randomUUID(),
      title: entryTitle,
      link: entryLink,
      description:
        text(it, 'summary') || text(it, 'content') || text(it, 'description'),
      pubDate:
        text(it, 'published') || text(it, 'updated') || text(it, 'pubDate'),
      feedUrl: '',
    })
  }

  return {
    meta: {
      url: '',
      title,
      link,
      description,
      lastFetched: new Date().toISOString(),
    },
    items,
  }
}

function parseFeedXML(xml: string): FeedData {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  // Check for parse error
  const parseErr = doc.querySelector('parsererror')
  if (parseErr) throw new Error(parseErr.textContent ?? 'XML parse failed')

  // Heuristic: RSS 2.0 has <channel>, Atom has <feed>
  if (first(doc, 'channel')) return parseRSS2(doc)
  if (first(doc, 'feed')) return parseAtom(doc)
  return {
    meta: { url: '', title: '', link: '', description: '', lastFetched: '' },
    items: [],
  }
}

/* ---- Fetch via dev-server proxy ---- */

export const FETCH_TIMEOUT_MS = 15_000

export async function fetchFeed(
  url: string,
  signal?: AbortSignal,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<FeedData> {
  const proxyUrl = '/api/rss-proxy?url=' + encodeURIComponent(url)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const res = await fetch(proxyUrl, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Failed to fetch feed: ${res.status} ${res.statusText}`)
    }
    const xml = await res.text()
    const data = parseFeedXML(xml)
    data.meta.url = url
    for (const it of data.items) it.feedUrl = url
    return data
  } catch (error) {
    if (timedOut && !signal?.aborted) {
      throw new Error(
        `Feed request timed out after ${timeoutMs / 1000}s: ${url}`,
        { cause: error },
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

/* ---- localStorage persistence ---- */

const FEEDS_KEY = 'rss-feeds-v1'
const ITEMS_PREFIX = 'rss-items-'
export const MAX_FEEDS = 25
export const MAX_ITEMS_PER_FEED = 100
export const FEED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFeedMeta(value: unknown): value is FeedMeta {
  if (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.link === 'string' &&
    typeof value.description === 'string' &&
    typeof value.lastFetched === 'string'
  ) {
    try {
      const url = new URL(value.url)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }
  return false
}

function isFeedItem(value: unknown): value is FeedItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.link === 'string' &&
    typeof value.description === 'string' &&
    typeof value.pubDate === 'string' &&
    typeof value.feedUrl === 'string'
  )
}

function storageKey(itemsKey: string): string {
  // Simple encoding: replace chars that might cause issues
  return ITEMS_PREFIX + btoa(encodeURIComponent(itemsKey))
}

export function loadFeeds(): FeedMeta[] {
  try {
    const raw = localStorage.getItem(FEEDS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(isFeedMeta).slice(-MAX_FEEDS)
  } catch {
    return []
  }
}

export function saveFeeds(feeds: FeedMeta[]): FeedMeta[] {
  const retainedFeeds = feeds.slice(-MAX_FEEDS)
  try {
    const retainedUrls = new Set(retainedFeeds.map((feed) => feed.url))
    for (const cachedFeed of loadFeeds()) {
      if (!retainedUrls.has(cachedFeed.url)) removeFeedCache(cachedFeed.url)
    }
    localStorage.setItem(FEEDS_KEY, JSON.stringify(retainedFeeds))
  } catch {
    // localStorage full or unavailable — non-critical
  }
  return retainedFeeds
}

export function loadFeedItems(url: string, now = Date.now()): FeedItem[] {
  try {
    const raw = localStorage.getItem(storageKey(url))
    if (!raw) return []
    const cached: unknown = JSON.parse(raw)
    if (!isRecord(cached) || !Array.isArray(cached.items)) return []
    if (
      typeof cached.savedAt !== 'number' ||
      now - cached.savedAt > FEED_CACHE_TTL_MS ||
      cached.savedAt > now
    ) {
      localStorage.removeItem(storageKey(url))
      return []
    }
    return cached.items.filter(isFeedItem)
  } catch {
    return []
  }
}

export function saveFeedItems(url: string, items: FeedItem[]): void {
  try {
    localStorage.setItem(
      storageKey(url),
      JSON.stringify({
        savedAt: Date.now(),
        items: items.slice(0, MAX_ITEMS_PER_FEED),
      }),
    )
  } catch {
    // non-critical
  }
}

export function removeFeedCache(url: string): void {
  try {
    localStorage.removeItem(storageKey(url))
  } catch {
    // non-critical
  }
}
