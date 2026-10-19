import assert from 'node:assert/strict'
import test from 'node:test'
import { hashForView, readViewFromHash, type View } from '../src/lib/routes.js'

test('reads a direct article link, including encoded slugs', () => {
  assert.deepEqual(readViewFromHash('#/post/hello%20world'), {
    page: 'detail',
    slug: 'hello world',
  })
})

test('preserves a selected tag in a shareable hash route', () => {
  assert.equal(
    hashForView({ page: 'blog', selectedTag: 'C++ & Web' }),
    '#/tag/C%2B%2B%20%26%20Web',
  )
})

test('round trips the main navigation routes', () => {
  const views: View[] = [
    { page: 'blog' },
    { page: 'archive' },
    { page: 'rss' },
    { page: 'todos' },
  ]
  for (const view of views) {
    assert.deepEqual(readViewFromHash(hashForView(view)), view)
  }
})

test('falls back to the blog for malformed or unknown hashes', () => {
  assert.deepEqual(readViewFromHash('#/post/%E0%A4%A'), { page: 'blog' })
  assert.deepEqual(readViewFromHash('#/unknown'), { page: 'blog' })
})
