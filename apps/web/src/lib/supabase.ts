import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client for server-side operations.
 *
 * Uses the service role key for job insertion. In production,
 * this should be replaced with per-user auth tokens via Supabase Auth
 * once the GitHub App OAuth flow is implemented.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables',
    )
  }

  return createClient(url, key)
}

/**
 * Create a Supabase client for client-side operations.
 *
 * Uses the anon key for read-only access (job status, events).
 * Write operations go through server actions.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables',
    )
  }

  return createClient(url, key)
}
