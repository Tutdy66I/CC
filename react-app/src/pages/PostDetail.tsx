import { useState, useEffect, type FC } from 'react'
import ReactMarkdown from 'react-markdown'

interface Props {
  slug: string
  onBack: () => void
}

const postModules = import.meta.glob('../posts/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const PostDetail: FC<Props> = ({ slug, onBack }) => {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const imp = postModules[`../posts/${slug}.md`]
    if (!imp) {
      setError(true)
      return
    }
    imp()
      .then((content) => setRaw(content))
      .catch(() => setError(true))
  }, [slug])

  if (error) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={onBack}>← Back</button>
        <p className="blog-not-found">Post not found.</p>
      </div>
    )
  }

  if (!raw) {
    return (
      <div className="blog-detail">
        <button className="blog-back" onClick={onBack}>← Back</button>
        <p className="blog-loading">Loading...</p>
      </div>
    )
  }

  const lines = raw.split('\n')
  const bodyLines = lines.filter(
    (l) => !/<!--\s*(title|date):/.test(l),
  )
  const body = bodyLines.join('\n').replace(/^\s*\n/, '')

  const titleMatch = raw.match(/<!--\s*title:\s*(.+?)\s*-->/)
  const dateMatch = raw.match(/<!--\s*date:\s*(.+?)\s*-->/)
  const title = titleMatch ? titleMatch[1] : slug
  const date = dateMatch ? dateMatch[1] : ''

  return (
    <article className="blog-detail">
      <button className="blog-back" onClick={onBack}>← Back</button>
      <h1 className="blog-detail-title">{title}</h1>
      {date && <time className="blog-detail-date">{date}</time>}
      <div className="blog-content">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </article>
  )
}

export default PostDetail
