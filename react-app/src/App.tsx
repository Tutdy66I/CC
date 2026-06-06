import { useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import ArchivePage from './pages/ArchivePage'
import TodoList from './components/TodoList'
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
        <PostDetail
          slug={view.slug}
          onBack={(selectedTag) =>
            setView({ page: 'blog', selectedTag })
          }
        />
      </>
    )
  }

  if (view.page === 'archive') {
    return (
      <>
        {nav}
        <ArchivePage
          onSelect={(slug) => setView({ page: 'detail', slug })}
        />
      </>
    )
  }

  if (view.page === 'todos') {
    return (
      <>
        {nav}
        <TodoList />
      </>
    )
  }

  return (
    <>
      {nav}
      <PostList
        onSelect={(slug) => setView({ page: 'detail', slug })}
      />
    </>
  )
}

export default App
