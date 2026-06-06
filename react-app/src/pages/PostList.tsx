import { parsePostMeta, type PostMeta } from '../lib/markdown'

interface Props {
  onSelect: (slug: string) => void
}

// Vite glob type isn't inferred with `import: 'default'` — bridge it at the boundary
const postModules = import.meta.glob('../posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const posts: PostMeta[] = Object.entries(postModules)
  .map(([path, raw]) => {
    const slug = path.replace(/^\.\.\/posts\//, '').replace(/\.md$/, '')
    const { title, date } = parsePostMeta(raw)
    return { slug, title: title || slug, date }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

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
