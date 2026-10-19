import { useEffect, useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import ArchivePage from './pages/ArchivePage'
import TodoList from './components/TodoList'
import RSSReader from './pages/RSSReader'
import Icon from './components/Icon'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { hashForView, readViewFromHash, type View } from './lib/routes'
import './App.css'

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
          <PostDetail
            slug={view.slug}
            onBack={(selectedTag) => navigate({ page: 'blog', selectedTag })}
          />
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'archive') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <ArchivePage
            onSelect={(slug) => navigate({ page: 'detail', slug })}
          />
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'rss') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <RSSReader />
        </ErrorBoundary>
      </>
    )
  }

  if (view.page === 'todos') {
    return (
      <>
        {nav}
        <ErrorBoundary>
          <TodoList />
        </ErrorBoundary>
      </>
    )
  }

  return (
    <>
      {nav}
      <ErrorBoundary>
        <PostList
          key={view.selectedTag ?? '_'}
          initialTag={view.selectedTag}
          onSelect={(slug) => navigate({ page: 'detail', slug })}
        />
      </ErrorBoundary>
    </>
  )
}

export default App
