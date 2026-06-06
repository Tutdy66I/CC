import { posts } from '../lib/markdown'

interface Props {
  onSelect: (slug: string) => void
}

export default function PostList({ onSelect }: Props) {
  return (
    <div className="blog-list">
      <h1 className="blog-heading">Blog</h1>

      {posts.length === 0 ? (
        <p className="blog-empty">No posts yet.</p>
      ) : (
        <ul className="blog-posts">
          {posts.map((p) => (
            <li key={p.slug}>
              <button className="blog-post-title" onClick={() => onSelect(p.slug)}>
                {p.title}
              </button>
              {p.date && <time className="blog-post-date">{p.date}</time>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
