import { useState, useRef, useMemo, type FormEvent } from 'react'
import {
  type FeedMeta,
  type FeedData,
  type FeedItem,
  fetchFeed,
  loadFeeds,
  saveFeeds,
  loadFeedItems,
  saveFeedItems,
  removeFeedCache,
} from '../lib/rss'
import './RSSReader.css'

/** Extract hostname without throwing on malformed URLs (e.g. corrupted cache) */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function RSSReader() {
  const [feeds, setFeeds] = useState<FeedMeta[]>(loadFeeds)
  const [selectedUrl, setSelectedUrl] = useState<string | null>(
    feeds.length > 0 ? feeds[0]!.url : null,
  )
  const [feedData, setFeedData] = useState<FeedData | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Monotonic id to discard stale async responses (race-condition guard)
  const requestIdRef = useRef(0)

  function selectFeed(url: string) {
    setSelectedUrl(url)
    setError(null)
    const cached = loadFeedItems(url)
    setFeedData(cached.length > 0 ? { meta: feeds.find(f => f.url === url)!, items: cached } : null)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = newUrl.trim()
    if (!trimmed) return

    // Validate URL
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      setError('Invalid URL.')
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setError('URL must start with http:// or https://')
      return
    }

    // Prevent duplicates
    if (feeds.some((f) => f.url === trimmed)) {
      setError('Feed already added.')
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFeed(trimmed)
      if (requestId !== requestIdRef.current) return // stale response
      const updated = [...feeds, data.meta]
      setFeeds(updated)
      saveFeeds(updated)
      saveFeedItems(trimmed, data.items)
      setFeedData(data)
      setSelectedUrl(trimmed)
      setNewUrl('')
    } catch (err) {
      if (requestId !== requestIdRef.current) return // stale response
      setError(
        err instanceof Error ? err.message : 'Failed to fetch feed.',
      )
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function handleRefresh(url: string) {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFeed(url)
      if (requestId !== requestIdRef.current) return // stale response
      const updated = feeds.map((f) =>
        f.url === url ? data.meta : f,
      )
      setFeeds(updated)
      saveFeeds(updated)
      saveFeedItems(url, data.items)
      if (selectedUrl === url) setFeedData(data)
    } catch (err) {
      if (requestId !== requestIdRef.current) return // stale response
      setError(
        err instanceof Error ? err.message : 'Failed to refresh.',
      )
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  function handleRemove(url: string) {
    requestIdRef.current++ // invalidate in-flight requests for the removed feed
    const updated = feeds.filter((f) => f.url !== url)
    setFeeds(updated)
    saveFeeds(updated)
    removeFeedCache(url)
    if (selectedUrl === url) {
      setSelectedUrl(updated.length > 0 ? updated[0]!.url : null)
      setFeedData(null)
    }
  }

  const selectedMeta = useMemo(
    () => feeds.find((f) => f.url === selectedUrl) ?? null,
    [feeds, selectedUrl],
  )
  // Read localStorage at most once per selection/cache change, not per render
  const cachedItems = useMemo<FeedItem[]>(
    () => (selectedUrl ? loadFeedItems(selectedUrl) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedUrl, feeds],
  )
  const isCached = cachedItems.length > 0

  return (
    <div className="rss-reader">
      <h1 className="rss-heading">RSS Reader</h1>

      {/* Add feed form */}
      <form className="rss-add-form" onSubmit={handleAdd}>
        <input
          ref={inputRef}
          className="rss-add-input"
          type="url"
          placeholder="https://example.com/feed.xml"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          disabled={loading}
        />
        <button
          className="rss-add-btn"
          type="submit"
          disabled={loading || !newUrl.trim()}
        >
          {loading ? '...' : 'Add'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="rss-error">
          <p>{error}</p>
          <button className="rss-error-dismiss" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Empty state */}
      {feeds.length === 0 && (
        <p className="rss-empty">No feeds yet. Add one above.</p>
      )}

      {/* Feed selector pills */}
      {feeds.length > 0 && (
        <div className="rss-feeds-bar">
          {feeds.map((f) => (
            <span
              key={f.url}
              className={
                f.url === selectedUrl
                  ? 'rss-feed-pill active'
                  : 'rss-feed-pill'
              }
            >
              <button
                className="rss-feed-pill-btn"
                onClick={() => selectFeed(f.url)}
              >
                {f.title || safeHostname(f.url)}
              </button>
              <button
                className="rss-feed-remove"
                onClick={() => handleRemove(f.url)}
                title="Remove feed"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Feed content */}
      {selectedMeta && feedData && (
        <section className="rss-feed-content">
          <header className="rss-feed-header">
            <div>
              <h2 className="rss-feed-title">
                {feedData.meta.link ? (
                  <a href={feedData.meta.link} target="_blank" rel="noopener noreferrer">
                    {feedData.meta.title || 'Untitled'}
                  </a>
                ) : (
                  feedData.meta.title || 'Untitled'
                )}
              </h2>
              {feedData.meta.description && (
                <p className="rss-feed-desc">{feedData.meta.description}</p>
              )}
              <span className="rss-feed-updated">
                Updated: {new Date(feedData.meta.lastFetched).toLocaleString()}
              </span>
            </div>
            <button
              className="rss-refresh-btn"
              onClick={() => handleRefresh(selectedMeta.url)}
              disabled={loading}
            >
              {loading ? '...' : 'Refresh'}
            </button>
          </header>

          <FeedItemList items={feedData.items} />
        </section>
      )}

      {/* Selected but not loaded — show cached or prompt refresh */}
      {selectedMeta && !feedData && (
        <section className="rss-feed-content">
          <header className="rss-feed-header">
            <div>
              <h2 className="rss-feed-title">
                {selectedMeta.title || safeHostname(selectedMeta.url)}
              </h2>
            </div>
            <button
              className="rss-refresh-btn"
              onClick={() => handleRefresh(selectedMeta.url)}
              disabled={loading}
            >
              {loading ? '...' : 'Refresh'}
            </button>
          </header>
          {isCached ? (
            <FeedItemList items={cachedItems} />
          ) : (
            <p className="rss-empty">
              No cached items. Click Refresh to fetch.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/** Date formatter shared by FeedItemList */
function formatDate(raw: string): string {
  try {
    return new Date(raw).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return raw
  }
}

/** Shared feed-item list used by loaded and cached views */
function FeedItemList({ items }: { items: FeedItem[] }) {
  const renderedItems = useMemo(
    () =>
      items.map((item) => ({
        item,
        desc: item.description ? stripHtml(item.description) : '',
      })),
    [items],
  )
  if (renderedItems.length === 0) {
    return <p className="rss-empty">No items in this feed.</p>
  }

  return (
    <ul className="rss-items">
      {renderedItems.map(({ item, desc }) => (
        <li key={item.id} className="rss-item">
          <h3 className="rss-item-title">
            {item.link ? (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.title || 'Untitled'}
              </a>
            ) : (
              item.title || 'Untitled'
            )}
          </h3>
          {item.pubDate && (
            <time className="rss-item-date">
              {formatDate(item.pubDate)}
            </time>
          )}
          {desc && (
            <p className="rss-item-desc">
              {desc.slice(0, 300)}
              {desc.length > 300 ? '…' : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Strip HTML tags, return plain text */
function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '')
  }
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? div.innerText ?? ''
}
