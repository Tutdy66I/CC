import { useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import TodoList from './components/TodoList'
import './App.css'

type View =
  | { page: 'blog' }
  | { page: 'detail'; slug: string }
  | { page: 'todos' }

function App() {
  const [view, setView] = useState<View>({ page: 'blog' })

  const nav = (
    <nav className="app-nav">
      <button
        className={view.page === 'blog' || view.page === 'detail' ? 'app-nav-btn active' : 'app-nav-btn'}
        onClick={() => setView({ page: 'blog' })}
      >
        Blog
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
        <PostDetail slug={view.slug} onBack={() => setView({ page: 'blog' })} />
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
      <PostList onSelect={(slug) => setView({ page: 'detail', slug })} />
    </>
  )
}

export default App
