import { useState } from 'react'
import { posts, getAllTags } from '../lib/markdown'
import TagBar from '../components/TagBar'

interface Props {
  onSelect: (slug: string) => void
}

export default function PostList({ onSelect }: Props) {
  const allTags = getAllTags()
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const filtered = selectedTag
    ? posts.filter((p) => p.tags.includes(selectedTag))
    : posts

  return (
    <div className="blog-list">
      <h1 className="blog-heading">Blog</h1>

      {allTags.length > 0 && (
        <TagBar
          tags={allTags}
          selected={selectedTag}
          onSelect={setSelectedTag}
        />
      )}

      {filtered.length === 0 ? (
        <p className="blog-empty">
          {selectedTag ? `No posts tagged "${selectedTag}".` : 'No posts yet.'}
        </p>
      ) : (
        <ul className="blog-posts">
          {filtered.map((p) => (
            <li key={p.slug}>
              <button
                className="blog-post-title"
                onClick={() => onSelect(p.slug)}
              >
                {p.title}
              </button>
              <div className="blog-post-meta">
                {p.date && <time className="blog-post-date">{p.date}</time>}
                {p.tags.map((t) => (
                  <span key={t} className="tag-inline">{t}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="blog-footer">
        {filtered.length !== posts.length
          ? `${filtered.length} / ${posts.length} posts`
          : `${posts.length} post${posts.length !== 1 ? 's' : ''}`}
      </footer>
    </div>
  )
}
