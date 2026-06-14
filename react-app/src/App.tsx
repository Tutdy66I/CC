import { useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import ArchivePage from './pages/ArchivePage'
import TodoList from './components/TodoList'
import Icon from './components/Icon'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './App.css'

type View =
  | { page: 'blog'; selectedTag?: string }
  | { page: 'detail'; slug: string }
  | { page: 'archive' }
  | { page: 'todos' }

function App() {
  const [view, setView] = useState<View>({ page: 'blog' })

  const isBlogSection = view.page === 'blog' || view.page === 'detail'

  const nav = (
    <nav className="app-nav">
      <Icon name="claude-icon" size={28} className="app-nav-icon" />
      <button
        className={
          isBlogSection ? 'app-nav-btn active' : 'app-nav-btn'
        }
        onClick={() => setView({ page: 'blog' })}
      >
        Blog
      </button>
      <button
        className={view.page === 'archive' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => setView({ page: 'archive' })}
      >
        Archive
      </button>
      <button
        className={view.page === 'todos' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => setView({ page: 'todos' })}
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
            onBack={(selectedTag) =>
              setView({ page: 'blog', selectedTag })
            }
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
            onSelect={(slug) => setView({ page: 'detail', slug })}
          />
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
          onSelect={(slug) => setView({ page: 'detail', slug })}
        />
      </ErrorBoundary>
    </>
  )
}

export default App
