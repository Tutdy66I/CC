import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Handle callbacks even when the initial hash route is Blog.
if (import.meta.env.VITE_EXPERIMENT_SYNC === 'true') {
  void import('./lib/supabaseClient').then(({ authRedirect }) => authRedirect())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
