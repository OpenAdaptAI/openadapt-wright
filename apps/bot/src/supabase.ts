import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js'
import {
  TABLES,
  JOB_STATUS,
  DEFAULT_MAX_LOOPS,
  DEFAULT_MAX_BUDGET_USD,
  type Job,
  type JobEvent,
} from '@wright/shared'

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: SupabaseClient | null = null

/**
 * Return the Supabase client, creating it on first call.
 *
 * Required env vars:
 *   SUPABASE_URL  – project URL (e.g. https://xyz.supabase.co)
 *   SUPABASE_KEY  – anon or service-role key
 */
export function getSupabase(): SupabaseClient {
  if (client) return client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_KEY environment variables',
    )
  }

  client = createClient(url, key)
  return client
}

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

export interface InsertJobParams {
  repoUrl: string
  task: string
  chatId: number
  messageId: number
  githubToken: string
  branch?: string
  maxLoops?: number
  maxBudgetUsd?: number
  /** For revision jobs: the existing feature branch to push to */
  featureBranch?: string
  /** For revision jobs: the parent job ID being revised */
  parentJobId?: string
}

/**
 * Insert a new job into the job_queue table.
 *
 * Returns the inserted row or throws on error.
 */
export async function insertJob(params: InsertJobParams): Promise<Job> {
  const sb = getSupabase()

  const row: Record<string, unknown> = {
    repo_url: params.repoUrl,
    task: params.task,
    branch: params.branch ?? 'main',
    max_loops: params.maxLoops ?? DEFAULT_MAX_LOOPS,
    max_budget_usd: params.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    status: JOB_STATUS.QUEUED,
    total_cost_usd: 0,
    github_token: params.githubToken,
    telegram_chat_id: params.chatId,
    telegram_message_id: params.messageId,
  }
  if (params.featureBranch) row.feature_branch = params.featureBranch
  if (params.parentJobId) row.parent_job_id = params.parentJobId

  const { data, error } = await sb
    .from(TABLES.JOB_QUEUE)
    .insert(row)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to insert job: ${error.message}`)
  }

  return data as Job
}

/**
 * Fetch a job by its ID. Returns null if not found.
 */
export async function getJob(jobId: string): Promise<Job | null> {
  const sb = getSupabase()

  const { data, error } = await sb
    .from(TABLES.JOB_QUEUE)
    .select('*')
    .eq('id', jobId)
    .single()

  if (error) {
    // PGRST116 = "No rows found"
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to fetch job: ${error.message}`)
  }

  return data as Job
}

/**
 * Fetch a job by an 8-char ID prefix. Returns null if not found or ambiguous.
 */
export async function getJobByPrefix(prefix: string): Promise<Job | null> {
  const sb = getSupabase()

  const { data, error } = await sb
    .from(TABLES.JOB_QUEUE)
    .select('*')
    .like('id', `${prefix}%`)
    .limit(2)

  if (error) {
    throw new Error(`Failed to fetch job by prefix: ${error.message}`)
  }

  // Return null if no match or ambiguous (multiple matches)
  if (!data || data.length !== 1) return null
  return data[0] as Job
}

/**
 * Attempt to cancel a job by setting its status to 'failed' with a
 * cancellation error. Only queued or running jobs can be cancelled.
 *
 * Returns the updated job or null if the job was not in a cancellable state.
 */
export async function cancelJob(jobId: string): Promise<Job | null> {
  const sb = getSupabase()

  const { data, error } = await sb
    .from(TABLES.JOB_QUEUE)
    .update({
      status: JOB_STATUS.FAILED,
      error: 'Cancelled by user via Telegram',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', [JOB_STATUS.QUEUED, JOB_STATUS.CLAIMED, JOB_STATUS.RUNNING])
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to cancel job: ${error.message}`)
  }

  return data as Job
}

/**
 * Fetch recent events for a job, ordered chronologically.
 */
export async function getJobEvents(
  jobId: string,
  limit = 20,
): Promise<JobEvent[]> {
  const sb = getSupabase()

  const { data, error } = await sb
    .from(TABLES.JOB_EVENTS)
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to fetch job events: ${error.message}`)
  }

  return (data ?? []) as JobEvent[]
}

// ---------------------------------------------------------------------------
// Realtime subscriptions
// ---------------------------------------------------------------------------

export type JobEventCallback = (event: JobEvent) => void

/**
 * Subscribe to INSERT events on the job_events table. Optionally filter by
 * a specific job_id. Returns the channel handle so the caller can
 * unsubscribe later.
 */
export function subscribeToJobEvents(
  callback: JobEventCallback,
  jobId?: string,
): RealtimeChannel {
  const sb = getSupabase()

  const filter = jobId
    ? `job_id=eq.${jobId}`
    : undefined

  const channel = sb
    .channel('job-events-bot')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: TABLES.JOB_EVENTS,
        ...(filter ? { filter } : {}),
      },
      (payload) => {
        callback(payload.new as JobEvent)
      },
    )
    .subscribe()

  return channel
}

/**
 * Subscribe to UPDATE events on the job_queue table (status changes).
 * Returns the channel so the caller can unsubscribe.
 */
export type JobUpdateCallback = (job: Job) => void

export function subscribeToJobUpdates(
  callback: JobUpdateCallback,
): RealtimeChannel {
  const sb = getSupabase()

  const channel = sb
    .channel('job-updates-bot')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: TABLES.JOB_QUEUE,
      },
      (payload) => {
        callback(payload.new as Job)
      },
    )
    .subscribe()

  return channel
}
