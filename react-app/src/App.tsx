import { useState } from 'react'
import PostList from './pages/PostList'
import PostDetail from './pages/PostDetail'
import './App.css'

type View = 'list' | { slug: string }

function App() {
  const [view, setView] = useState<View>('list')

  if (typeof view === 'object') {
    return <PostDetail slug={view.slug} onBack={() => setView('list')} />
  }

  return (
    <PostList onSelect={(slug) => setView({ slug })} />
  )
}

export default App
