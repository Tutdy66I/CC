import { lazy, Suspense, useEffect, useState } from 'react'
import Icon from './components/Icon'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { hashForView, readViewFromHash, type View } from './lib/routes'
import './App.css'

const PostList = lazy(() => import('./pages/PostList'))
const PostDetail = lazy(() => import('./pages/PostDetail'))
const ArchivePage = lazy(() => import('./pages/ArchivePage'))
const TodoList = lazy(() => import('./components/TodoList'))
const RSSReader = lazy(() => import('./pages/RSSReader'))

function App() {
  const [view, setView] = useState<View>(() =>
    readViewFromHash(window.location.hash),
  )

  useEffect(() => {
    const syncView = () => setView(readViewFromHash(window.location.hash))
    window.addEventListener('hashchange', syncView)
    return () => window.removeEventListener('hashchange', syncView)
  }, [])

  function navigate(nextView: View) {
    setView(nextView)
    const nextHash = hashForView(nextView)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
  }

  const isBlogSection = view.page === 'blog' || view.page === 'detail'

  const nav = (
    <nav className="app-nav">
      <Icon name="claude-icon" size={28} className="app-nav-icon" />
      <button
        className={isBlogSection ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => navigate({ page: 'blog' })}
      >
        Blog
      </button>
      <button
        className={
          view.page === 'archive' ? 'app-nav-btn active' : 'app-nav-btn'
        }
        onClick={() => navigate({ page: 'archive' })}
      >
        Archive
      </button>
      <button
        className={view.page === 'rss' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => navigate({ page: 'rss' })}
      >
        RSS
      </button>
      <button
        className={view.page === 'todos' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => navigate({ page: 'todos' })}
      >
        Todos
      </button>
    </nav>
  )

  if (view.page === 'detail') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <Suspense fallback={<p className="app-loading">Loading…</p>}>
            <PostDetail
              slug={view.slug}
              onBack={(selectedTag) => navigate({ page: 'blog', selectedTag })}
            />
          </Suspense>
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'archive') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <Suspense fallback={<p className="app-loading">Loading…</p>}>
            <ArchivePage
              onSelect={(slug) => navigate({ page: 'detail', slug })}
            />
          </Suspense>
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'rss') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <Suspense fallback={<p className="app-loading">Loading…</p>}>
            <RSSReader />
          </Suspense>
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'todos') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <Suspense fallback={<p className="app-loading">Loading…</p>}>
            <TodoList />
          </Suspense>
        </ErrorBoundary>
      </>
    )
  }

  return (
    <>
      {nav}
      <ErrorBoundary>
        <Suspense fallback={<p className="app-loading">Loading…</p>}>
          <PostList
            key={view.selectedTag ?? '_'}
            initialTag={view.selectedTag}
            onSelect={(slug) => navigate({ page: 'detail', slug })}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

export default App
