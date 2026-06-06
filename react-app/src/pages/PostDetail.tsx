import ReactMarkdown from 'react-markdown'
import { parsePostMeta, stripMetaComments, getPostContent } from '../lib/markdown'
import { ErrorBoundary } from '../lib/ErrorBoundary'

interface Props {
  slug: string
  onBack: (selectedTag?: string) => void
}

export default function PostDetail({ slug, onBack }: Props) {
  const raw = getPostContent(slug)

  if (!raw) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={() => onBack()}>
          ← Back
        </button>
        <p className="blog-not-found">Post not found.</p>
      </div>
    )
  }

  const body = stripMetaComments(raw)
  const { title, date, tags } = parsePostMeta(raw)

  return (
    <article className="blog-detail">
      <button className="blog-back" onClick={() => onBack()}>
        ← Back
      </button>
      <h1 className="blog-detail-title">{title || slug}</h1>
      <div className="blog-detail-meta">
        {date && <time className="blog-detail-date">{date}</time>}
        {tags.map((t) => (
          <button
            key={t}
            className="tag-inline"
            onClick={() => onBack(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="blog-content">
        <ErrorBoundary>
          <ReactMarkdown>{body}</ReactMarkdown>
        </ErrorBoundary>
      </div>
    </article>
  )
}
