import { createClient } from '@supabase/supabase-js'
import type { CloudRecord, insertPayload } from './experimentSync'

type Database = {
  public: {
    Tables: {
      experiment_records: {
        Row: { [K in keyof CloudRecord]: CloudRecord[K] }
        Insert: ReturnType<typeof insertPayload>
        Update: { analysis?: string; deleted_at?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

function configuration(): { url: string; key: string } | null {
  if (import.meta.env.VITE_EXPERIMENT_SYNC !== 'true') return null
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
    | string
    | undefined
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL as string)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !key?.startsWith('sb_publishable_')
    )
      return null
    return { url: url.origin, key }
  } catch {
    return null
  }
}

const config = configuration()
let retryNotBefore = 0
export function cloudRetryDelay(): number {
  return Math.max(0, retryNotBefore - Date.now())
}
export const cloudNamespace = config
  ? `${config.url}|${import.meta.env.BASE_URL}`
  : 'disabled'
export const supabase =
  import.meta.env.VITE_EXPERIMENT_SYNC === 'true' && config
    ? createClient<Database>(config.url, config.key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
          storageKey: `signallab-auth:${cloudNamespace}`,
        },
        global: {
          fetch: async (input, init) => {
            const response = await fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
                : AbortSignal.timeout(20000),
            })
            if (response.status === 429 || response.status === 503) {
              const header = response.headers.get('Retry-After')
              const seconds = header === null ? NaN : Number(header)
              const deadline = Number.isFinite(seconds)
                ? Date.now() + Math.max(0, seconds) * 1000
                : Date.parse(header ?? '')
              if (Number.isFinite(deadline))
                retryNotBefore = Math.max(retryNotBefore, deadline)
              else if (response.status === 429)
                retryNotBefore = Math.max(retryNotBefore, Date.now() + 60000)
            }
            return response
          },
        },
      })
    : null

export async function completeAuthRedirect(): Promise<string> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const authError = url.searchParams.get('error')
  if (!supabase || (!code && !authError)) return ''
  // Callback is the existing static entry point, never a nonexistent Pages path.
  if (url.pathname !== import.meta.env.BASE_URL) return ''
  try {
    if (authError) return 'GitHub 登录未完成，请重试。'
    const { error } = await supabase.auth.exchangeCodeForSession(code!)
    return error ? '登录回跳失效，请在此浏览器重新发起 GitHub 登录。' : ''
  } catch {
    return '登录回跳失败，请重新登录。'
  } finally {
    history.replaceState(null, '', `${import.meta.env.BASE_URL}#/signallab`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

// One exchange per page load, independent of React StrictMode and component mounts.
let redirect: Promise<string> | undefined
export function authRedirect(): Promise<string> {
  return (redirect ??= completeAuthRedirect())
}

export async function signInWithGitHub(): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href,
    },
  })
  if (error) throw new Error('无法发起 GitHub 登录，请稍后重试。')
}
