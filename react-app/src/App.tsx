import { useState, type ReactNode } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import ArchivePage from './pages/ArchivePage'
import TodoList from './components/TodoList'
import RSSReader from './pages/RSSReader'
import Icon from './components/Icon'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './App.css'

type View =
  | { page: 'blog'; selectedTag?: string }
  | { page: 'detail'; slug: string }
  | { page: 'archive' }
  | { page: 'rss' }
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
        className={view.page === 'rss' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => setView({ page: 'rss' })}
      >
        RSS
      </button>
      <button
        className={view.page === 'todos' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => setView({ page: 'todos' })}
      >
        Todos
      </button>
    </nav>
  )

  let content: ReactNode
  switch (view.page) {
    case 'detail':
      content = (
        <PostDetail
          slug={view.slug}
          onBack={(selectedTag) =>
            setView({ page: 'blog', selectedTag })
          }
        />
      )
      break
    case 'archive':
      content = (
        <ArchivePage
          onSelect={(slug) => setView({ page: 'detail', slug })}
        />
      )
      break
    case 'rss':
      content = <RSSReader />
      break
    case 'todos':
      content = <TodoList />
      break
    case 'blog':
      content = (
        <PostList
          key={view.selectedTag ?? '_'}
          initialTag={view.selectedTag}
          onSelect={(slug) => setView({ page: 'detail', slug })}
        />
      )
      break
  }

  return (
    <>
      {nav}
      <ErrorBoundary>{content}</ErrorBoundary>
    </>
  )
}

export default App
