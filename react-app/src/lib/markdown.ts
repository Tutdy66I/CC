// Regex patterns for Post metadata inside Markdown HTML comments
const TITLE_RE = /<!--\s*title:\s*(.+?)\s*-->/
const DATE_RE = /<!--\s*date:\s*(.+?)\s*-->/
const META_COMMENT_RE = /<!--\s*(title|date):.*?-->/

export interface PostMeta {
  slug: string
  title: string
  date: string
}

/** Extract title and date from markdown comment metadata */
export function parsePostMeta(raw: string): { title: string; date: string } {
  const titleMatch = raw.match(TITLE_RE)
  const dateMatch = raw.match(DATE_RE)
  return {
    title: titleMatch ? titleMatch[1] : '',
    date: dateMatch ? dateMatch[1] : '',
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
