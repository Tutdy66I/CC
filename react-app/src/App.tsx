import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import Icon from './components/Icon'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { hashForView, readViewFromHash, type View } from './lib/routes'
import './App.css'

const PostList = lazy(() => import('./pages/PostList'))
const PostDetail = lazy(() => import('./pages/PostDetail'))
const ArchivePage = lazy(() => import('./pages/ArchivePage'))
const TodoList = lazy(() => import('./components/TodoList'))
const RSSReader = lazy(() => import('./pages/RSSReader'))
const SignalLab = lazy(() => import('./pages/SignalLab'))
const OfdmCompat = lazy(() => import('./ofdm-record-compat/CompatImport'))

function App() {
  const [showOfdmCompat, setShowOfdmCompat] = useState(false)
  const [view, setView] = useState<View>(() =>
    readViewFromHash(window.location.hash),
  )

  useEffect(() => {
    let active = true
    const syncView = () => setView(readViewFromHash(window.location.hash))
    window.addEventListener('hashchange', syncView)
    // Auth may replace the hash between the initial render and listener setup.
    queueMicrotask(() => {
      if (active) syncView()
    })
    return () => {
      active = false
      window.removeEventListener('hashchange', syncView)
    }
  }, [])

  function navigate(nextView: View) {
    setView(nextView)
    const nextHash = hashForView(nextView)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
  }
  useEffect(() => {
    document.title = view.page === 'signallab' ? 'SignalLab AI · v1.4' : 'Blog'
  }, [view.page])

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
      <button
        aria-current={view.page === 'signallab' ? 'page' : undefined}
        className={
          view.page === 'signallab' ? 'app-nav-btn active' : 'app-nav-btn'
        }
        onClick={() => navigate({ page: 'signallab' })}
      >
        SignalLab AI
      </button>
    </nav>
  )

  let content: ReactNode
  switch (view.page) {
    case 'detail':
      content = (
        <PostDetail
          slug={view.slug}
          onBack={(selectedTag) => navigate({ page: 'blog', selectedTag })}
        />
      )
      break
    case 'archive':
      content = (
        <ArchivePage onSelect={(slug) => navigate({ page: 'detail', slug })} />
      )
      break
    case 'rss':
      content = <RSSReader />
      break
    case 'signallab':
      content = (
        <>
          <button
            type="button"
            onClick={() => setShowOfdmCompat((v) => !v)}
            aria-expanded={showOfdmCompat}
          >
            OFDM 兼容记录
          </button>
          {showOfdmCompat && <OfdmCompat />}
          <SignalLab />
        </>
      )
      break
    case 'todos':
      content = <TodoList />
      break
    case 'blog':
      content = (
        <PostList
          key={view.selectedTag ?? '_'}
          initialTag={view.selectedTag}
          onSelect={(slug) => navigate({ page: 'detail', slug })}
        />
      )
      break
  }

  return (
    <>
      {nav}
      {import.meta.env.VITE_STATIC_HOST === 'true' && (
        <p className="app-loading" role="note">
          此站点由 GitHub Pages 静态托管，通信实验与报告导出可直接使用。 AI
          助教和 RSS 订阅抓取需要另行连接 Node 后端；本机完整运行方式见仓库
          README。
        </p>
      )}
      <ErrorBoundary>
        <Suspense fallback={<p className="app-loading">Loading…</p>}>
          {content}
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

export default App
