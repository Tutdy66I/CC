import { useEffect, useRef, useState, type FormEvent } from 'react'
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

export default function RSSReader() {
  const [initialState] = useState(() => {
    const feeds = loadFeeds()
    const selectedUrl = feeds[0]?.url ?? null
    const cachedItems = selectedUrl ? loadFeedItems(selectedUrl) : []
    const selectedMeta = feeds.find((feed) => feed.url === selectedUrl)

    return {
      feeds,
      selectedUrl,
      feedData:
        selectedMeta && cachedItems.length > 0
          ? { meta: selectedMeta, items: cachedItems }
          : null,
    }
  })
  const [feeds, setFeeds] = useState<FeedMeta[]>(initialState.feeds)
  const [selectedUrl, setSelectedUrl] = useState<string | null>(
    initialState.selectedUrl,
  )
  const [feedData, setFeedData] = useState<FeedData | null>(
    initialState.feedData,
  )
  const [newUrl, setNewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedUrlRef = useRef(selectedUrl)
  const activeRequestRef = useRef<AbortController | null>(null)
  const activeRequestUrlRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(
    () => () => {
      requestIdRef.current++
      activeRequestRef.current?.abort()
    },
    [],
  )

  function beginRequest(url: string) {
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    activeRequestUrlRef.current = url
    const id = ++requestIdRef.current
    setLoading(true)
    setError(null)
    return { controller, id }
  }

  function finishRequest(id: number) {
    if (requestIdRef.current !== id) return
    activeRequestRef.current = null
    activeRequestUrlRef.current = null
    setLoading(false)
    inputRef.current?.focus()
  }

  function updateSelectedUrl(url: string | null) {
    selectedUrlRef.current = url
    setSelectedUrl(url)
  }

  function selectFeed(url: string) {
    updateSelectedUrl(url)
    setError(null)
    const cached = loadFeedItems(url)
    const meta = feeds.find((feed) => feed.url === url)
    setFeedData(meta && cached.length > 0 ? { meta, items: cached } : null)
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

    const request = beginRequest(trimmed)
    try {
      const data = await fetchFeed(trimmed, request.controller.signal)
      if (requestIdRef.current !== request.id) return
      const updated = [...feeds, data.meta]
      setFeeds(updated)
      saveFeeds(updated)
      saveFeedItems(trimmed, data.items)
      setFeedData(data)
      updateSelectedUrl(trimmed)
      setNewUrl('')
    } catch (err) {
      if (
        !request.controller.signal.aborted &&
        requestIdRef.current === request.id
      ) {
        setError(err instanceof Error ? err.message : 'Failed to fetch feed.')
      }
    } finally {
      finishRequest(request.id)
    }
  }

  async function handleRefresh(url: string) {
    const request = beginRequest(url)
    try {
      const data = await fetchFeed(url, request.controller.signal)
      if (requestIdRef.current !== request.id) return
      const updated = feeds.map((f) => (f.url === url ? data.meta : f))
      setFeeds(updated)
      saveFeeds(updated)
      saveFeedItems(url, data.items)
      if (selectedUrlRef.current === url) {
        setFeedData(data)
      }
    } catch (err) {
      if (
        !request.controller.signal.aborted &&
        requestIdRef.current === request.id &&
        selectedUrlRef.current === url
      ) {
        setError(err instanceof Error ? err.message : 'Failed to refresh.')
      }
    } finally {
      finishRequest(request.id)
    }
  }

  function handleRemove(url: string) {
    if (activeRequestUrlRef.current === url) {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
      activeRequestUrlRef.current = null
      requestIdRef.current++
      setLoading(false)
    }

    const updated = feeds.filter((f) => f.url !== url)
    setFeeds(updated)
    saveFeeds(updated)
    removeFeedCache(url)
    if (selectedUrlRef.current === url) {
      const nextUrl = updated[0]?.url ?? null
      updateSelectedUrl(nextUrl)
      const nextItems = nextUrl ? loadFeedItems(nextUrl) : []
      const nextMeta = updated.find((feed) => feed.url === nextUrl)
      setFeedData(
        nextMeta && nextItems.length > 0
          ? { meta: nextMeta, items: nextItems }
          : null,
      )
    }
  }

  const selectedMeta = feeds.find((f) => f.url === selectedUrl) ?? null

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
                f.url === selectedUrl ? 'rss-feed-pill active' : 'rss-feed-pill'
              }
            >
              <button
                className="rss-feed-pill-btn"
                onClick={() => selectFeed(f.url)}
              >
                {f.title || new URL(f.url).hostname}
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
                  <a
                    href={feedData.meta.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
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

          <FeedItemList key={selectedMeta.url} items={feedData.items} />
        </section>
      )}

      {/* Selected but not loaded — show cached or prompt refresh */}
      {selectedMeta && !feedData && (
        <section className="rss-feed-content">
          <header className="rss-feed-header">
            <div>
              <h2 className="rss-feed-title">
                {selectedMeta.title || new URL(selectedMeta.url).hostname}
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
          <p className="rss-empty">No cached items. Click Refresh to fetch.</p>
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
  const [query, setQuery] = useState('')

  if (items.length === 0) {
    return <p className="rss-empty">No items in this feed.</p>
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredItems = normalizedQuery
    ? items.filter((item) => {
        const searchableText = `${item.title} ${stripHtml(item.description ?? '')}`
        return searchableText.toLocaleLowerCase().includes(normalizedQuery)
      })
    : items

  return (
    <>
      <div className="rss-search">
        <input
          className="rss-search-input"
          type="search"
          placeholder="Search articles..."
          aria-label="Search articles by title or summary"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            className="rss-search-clear"
            type="button"
            onClick={() => setQuery('')}
          >
            Clear
          </button>
        )}
      </div>
      {filteredItems.length > 0 ? (
        <ul className="rss-items">
          {filteredItems.map((item) => {
            const desc = item.description ? stripHtml(item.description) : ''
            return (
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
            )
          })}
        </ul>
      ) : (
        <p className="rss-empty">No articles match “{query}”.</p>
      )}
    </>
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
