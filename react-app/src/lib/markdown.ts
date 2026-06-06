// Regex patterns for Post metadata inside Markdown HTML comments
const TITLE_RE = /<!--\s*title:\s*(.+?)\s*-->/
const DATE_RE = /<!--\s*date:\s*(.+?)\s*-->/
const TAGS_RE = /<!--\s*tags:\s*(.+?)\s*-->/
const META_COMMENT_RE = /<!--\s*(title|date|tags):.*?-->/

export interface PostMeta {
  slug: string
  title: string
  date: string
  tags: string[]
}

// Single eager glob — shared by PostList and PostDetail, no duplicate warnings
const postModules = import.meta.glob('../posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** All posts, parsed and sorted by date descending */
export const posts: PostMeta[] = Object.entries(postModules)
  .map(([path, raw]) => {
    const slug = path.replace(/^\.\.\/posts\//, '').replace(/\.md$/, '')
    const { title, date, tags } = parsePostMeta(raw)
    return { slug, title: title || slug, date, tags }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

/** Unique tags across all posts, sorted by post count descending then alphabetically */
export function getAllTags(): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  for (const p of posts) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) || 0) + 1)
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Get raw markdown content by slug */
export function getPostContent(slug: string): string | null {
  const key = `../posts/${slug}.md`
  return postModules[key] ?? null
}

/** Extract title, date, and tags from markdown comment metadata */
export function parsePostMeta(raw: string): { title: string; date: string; tags: string[] } {
  const titleMatch = raw.match(TITLE_RE)
  const dateMatch = raw.match(DATE_RE)
  const tagsMatch = raw.match(TAGS_RE)
  return {
    title: titleMatch ? titleMatch[1] : '',
    date: dateMatch ? dateMatch[1] : '',
    tags: tagsMatch
      ? tagsMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  }
}

/** Remove metadata comment lines from markdown body */
export function stripMetaComments(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !META_COMMENT_RE.test(line))
    .join('\n')
    .replace(/^\s*\n/, '')
}
