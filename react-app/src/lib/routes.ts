export type View =
  | { page: 'blog'; selectedTag?: string }
  | { page: 'detail'; slug: string }
  | { page: 'archive' }
  | { page: 'rss' }
  | { page: 'todos' }
  | { page: 'signallab' }

export function readViewFromHash(hash: string): View {
  const path = hash.replace(/^#\/?/, '')
  if (!path) return { page: 'blog' }

  const [route, ...segments] = path.split('/')
  try {
    switch (route) {
      case 'post':
        return segments.length > 0
          ? { page: 'detail', slug: decodeURIComponent(segments.join('/')) }
          : { page: 'blog' }
      case 'tag':
        return segments.length > 0
          ? {
              page: 'blog',
              selectedTag: decodeURIComponent(segments.join('/')),
            }
          : { page: 'blog' }
      case 'archive':
        return { page: 'archive' }
      case 'rss':
        return { page: 'rss' }
      case 'todos':
        return { page: 'todos' }
      case 'signallab':
        return { page: 'signallab' }
      default:
        return { page: 'blog' }
    }
  } catch {
    return { page: 'blog' }
  }
}

export function hashForView(view: View): string {
  switch (view.page) {
    case 'detail':
      return `#/post/${encodeURIComponent(view.slug)}`
    case 'blog':
      return view.selectedTag
        ? `#/tag/${encodeURIComponent(view.selectedTag)}`
        : '#/'
    case 'archive':
      return '#/archive'
    case 'rss':
      return '#/rss'
    case 'todos':
      return '#/todos'
    case 'signallab':
      return '#/signallab'
  }
}
