import { type FC } from 'react'

interface PostMeta {
  slug: string
  title: string
  date: string
}

const postModules = import.meta.glob('../posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const posts: PostMeta[] = Object.entries(postModules)
  .map(([path, raw]) => {
    const slug = path.replace(/^\.\.\/posts\//, '').replace(/\.md$/, '')
    const lines = raw.split('\n')
    let title = slug
    let date = ''
    for (const line of lines) {
      const t = line.match(/<!--\s*title:\s*(.+?)\s*-->/)
      const d = line.match(/<!--\s*date:\s*(.+?)\s*-->/)
      if (t) title = t[1]
      if (d) date = d[1]
    }
    return { slug, title, date }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

interface Props {
  onSelect: (slug: string) => void
}

const PostList: FC<Props> = ({ onSelect }) => {
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

export default PostList
