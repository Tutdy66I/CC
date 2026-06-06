import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const POSTS_DIR = join(import.meta.dirname, '..', 'src', 'posts')
const DIST_DIR = join(import.meta.dirname, '..', 'dist')
const YOUR_DOMAIN = 'YOUR_DOMAIN'

// Frontmatter regex
const TITLE_RE = /<!--\s*title:\s*(.+?)\s*-->/
const DATE_RE = /<!--\s*date:\s*(.+?)\s*-->/

function xmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function readPosts() {
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'))
  const posts = []

  for (const file of files) {
    const raw = readFileSync(join(POSTS_DIR, file), 'utf-8')
    const slug = file.replace(/\.md$/, '')

    const titleMatch = raw.match(TITLE_RE)
    const dateMatch = raw.match(DATE_RE)
    const title = titleMatch ? titleMatch[1] : slug
    const date = dateMatch ? dateMatch[1] : ''

    // Strip metadata comments for description
    const body = raw
      .split('\n')
      .filter((l) => !/<!--\s*(title|date|tags):/.test(l))
      .join('\n')
      .trim()

    // First 200 chars of plain text for description
    const desc = body.replace(/```[\s\S]*?```/g, '') // strip code blocks
      .replace(/[#*`\[\]()>_-]/g, '')              // strip markdown syntax
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 200)

    posts.push({ slug, title, date, description: desc })
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date))
}

function generateRSS() {
  const posts = readPosts()
  const now = new Date().toUTCString()

  const items = posts
    .map(
      (p) => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>https://${YOUR_DOMAIN}/#/post/${p.slug}</link>
      <description>${xmlEscape(p.description)}</description>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <guid>https://${YOUR_DOMAIN}/#/post/${p.slug}</guid>
    </item>`,
    )
    .join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog</title>
    <link>https://${YOUR_DOMAIN}/</link>
    <description>Blog posts</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="https://${YOUR_DOMAIN}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`

  writeFileSync(join(DIST_DIR, 'rss.xml'), rss, 'utf-8')
  console.log(`Generated ${posts.length} items → dist/rss.xml`)
}

generateRSS()
