import { useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import './App.css'

type View =
  | { page: 'list' }
  | { page: 'detail'; slug: string }

function App() {
  const [view, setView] = useState<View>({ page: 'list' })

  if (view.page === 'detail') {
    return <PostDetail slug={view.slug} onBack={() => setView({ page: 'list' })} />
  }

  return (
    <PostList onSelect={(slug) => setView({ page: 'detail', slug })} />
  )
}

export default App
