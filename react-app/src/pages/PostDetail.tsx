import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { parsePostMeta, stripMetaComments, getPostContent } from '../lib/markdown'
import { ErrorBoundary } from '../lib/ErrorBoundary'

interface Props {
  slug: string
  onBack: () => void
}

export default function PostDetail({ slug, onBack }: Props) {
  const [raw] = useState<string | null>(() => getPostContent(slug))

  if (!raw) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={onBack}>
          ← Back
        </button>
        <p className="blog-not-found">Post not found.</p>
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
