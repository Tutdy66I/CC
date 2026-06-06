import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { parsePostMeta, stripMetaComments } from '../lib/markdown'
import { ErrorBoundary } from '../lib/ErrorBoundary'

interface Props {
  slug: string
  onBack: () => void
}

const postModules = import.meta.glob('../posts/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export default function PostDetail({ slug, onBack }: Props) {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const moduleKey = `../posts/${slug}.md`
  const loadModule = postModules[moduleKey]

  useEffect(() => {
    if (!loadModule) return // handled during render
    let ignore = false
    loadModule()
      .then((content) => {
        if (!ignore) setRaw(content)
      })
      .catch(() => {
        if (!ignore) setError(true)
      })
    return () => {
      ignore = true
    }
  }, [loadModule])

  if (!loadModule || error) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={onBack}>
          ← Back
        </button>
        <p className="blog-not-found">
          {error ? 'Failed to load post.' : 'Post not found.'}
        </p>
      </div>
    )
  }

  if (!raw) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={onBack}>
          ← Back
        </button>
        <p className="blog-loading">Loading...</p>
      </div>
    )
  }

  const body = stripMetaComments(raw)
  const { title, date } = parsePostMeta(raw)

  return (
    <article className="blog-detail">
      <button className="blog-back" onClick={onBack}>
        ← Back
      </button>
      <h1 className="blog-detail-title">{title || slug}</h1>
      {date && <time className="blog-detail-date">{date}</time>}
      <div className="blog-content">
        <ErrorBoundary>
          <ReactMarkdown>{body}</ReactMarkdown>
        </ErrorBoundary>
      </div>
    </article>
  )
}
