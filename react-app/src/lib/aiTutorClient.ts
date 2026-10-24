import { supabase } from './supabaseClient'

export async function tutorHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (supabase) {
    const { data, error } = await supabase.auth.getSession()
    if (!error && data.session)
      headers.Authorization = `Bearer ${data.session.access_token}`
  }
  return headers
}
