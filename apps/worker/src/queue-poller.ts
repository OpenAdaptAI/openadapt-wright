import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Job } from '@wright/shared'
import { POLL_INTERVAL_MS, STALE_CLAIMED_MS, STALE_RUNNING_MS } from '@wright/shared'
import { runDevLoop } from './dev-loop.js'

// Worker identity — use Fly machine ID if available, otherwise hostname
const WORKER_ID =
  process.env.FLY_MACHINE_ID || process.env.HOSTNAME || `worker-${Date.now()}`

// State
let supabase: SupabaseClient | null = null
let shuttingDown = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let currentJob: Job | null = null
let currentAbortController: AbortController | null = null

// Callbacks for the main server to track active jobs
let onJobStart: ((jobId: string, controller: AbortController) => void) | null =
  null
let onJobEnd: ((jobId: string) => void) | null = null

export function setJobCallbacks(callbacks: {
  onJobStart: (jobId: string, controller: AbortController) => void
  onJobEnd: (jobId: string) => void
}) {
  onJobStart = callbacks.onJobStart
  onJobEnd = callbacks.onJobEnd
}

export function isPolling(): boolean {
  return !shuttingDown && supabase !== null
}

export function isDraining(): boolean {
  return shuttingDown && currentJob !== null
}

export function getCurrentJob(): Job | null {
  return currentJob
}

/**
 * Initialize the queue poller. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */
export function initQueuePoller(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.warn(
      '[queue-poller] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — queue polling disabled',
    )
    return false
  }

  supabase = createClient(url, key)
  console.log(`[queue-poller] Initialized with worker ID: ${WORKER_ID}`)
  return true
}

/**
 * Start polling for jobs. Call after initQueuePoller().
 */
export async function startPolling(): Promise<void> {
  if (!supabase) {
    console.error('[queue-poller] Cannot start polling — not initialized')
    return
  }

  await startupCleanup()

  console.log(`[queue-poller] Polling every ${POLL_INTERVAL_MS}ms`)
  poll()
}

/**
 * Stop polling for new jobs. Any currently running job will continue to completion.
 */
export function stopPolling(): void {
  shuttingDown = true
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * Enter drain mode: stop accepting new jobs, let current job finish.
 */
export function drain(): { draining: boolean; currentJobId: string | null } {
  stopPolling()
  return {
    draining: currentJob !== null,
    currentJobId: currentJob?.id ?? null,
  }
}

/**
 * Re-queue the current running job. Called during SIGTERM.
 */
export async function requeueCurrentJob(): Promise<string | null> {
  if (!currentJob || !supabase) return null

  const job = currentJob
  console.log(
    `[queue-poller] Re-queuing job ${job.id}, attempt ${job.attempt}/${job.max_attempts}`,
  )

  // Abort the running dev loop
  if (currentAbortController) {
    currentAbortController.abort()
  }

  if (job.attempt < job.max_attempts) {
    // Re-queue for retry
    await supabase
      .from('job_queue')
      .update({
        status: 'queued',
        worker_id: null,
        claimed_at: null,
        started_at: null,
        attempt: job.attempt + 1,
        error: `Re-queued: worker shutdown (SIGTERM), attempt ${job.attempt + 1}/${job.max_attempts}`,
      })
      .eq('id', job.id)

    await emitEvent(supabase, job.id, 'error', undefined, {
      message: `Job interrupted by worker restart. Re-queued automatically (attempt ${job.attempt + 1}/${job.max_attempts}).`,
      recovery: true,
    })

    console.log(
      `[queue-poller] Job ${job.id} re-queued as attempt ${job.attempt + 1}`,
    )
    return job.id
  } else {
    // Max attempts exceeded — mark as permanently failed
    await supabase
      .from('job_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: `Failed after ${job.max_attempts} attempts (worker restarts)`,
      })
      .eq('id', job.id)

    await emitEvent(supabase, job.id, 'error', undefined, {
      message: `Job failed permanently after ${job.max_attempts} attempts due to worker restarts.`,
    })

    console.log(
      `[queue-poller] Job ${job.id} permanently failed (max attempts exceeded)`,
    )
    return job.id
  }
}

// ---- Internal ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    pollTimer = setTimeout(resolve, ms)
  })
}

async function poll(): Promise<void> {
  while (!shuttingDown) {
    try {
      const job = await claimJob()
      if (job) {
        await processJob(job)
      }
    } catch (err) {
      console.error('[queue-poller] Poll error:', err)
    }

    if (!shuttingDown) {
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

async function claimJob(): Promise<Job | null> {
  if (!supabase || shuttingDown) return null

  // Find oldest queued job
  const { data: jobs, error } = await supabase
    .from('job_queue')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error(
      '[queue-poller] Failed to query job_queue:',
      error.message,
    )
    return null
  }

  if (!jobs || jobs.length === 0) return null

  const job = jobs[0] as Job

  // Atomic claim: only update if still queued
  const { data: claimed, error: claimError } = await supabase
    .from('job_queue')
    .update({
      status: 'claimed',
      worker_id: WORKER_ID,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select()
    .single()

  if (claimError || !claimed) {
    return null
  }

  return claimed as Job
}

async function processJob(job: Job): Promise<void> {
  if (!supabase) return

  currentJob = job
  const abortController = new AbortController()
  currentAbortController = abortController

  if (onJobStart) onJobStart(job.id, abortController)

  console.log(
    `[queue-poller] Processing job ${job.id} (attempt ${job.attempt})`,
  )

  try {
    // Mark as running
    await supabase
      .from('job_queue')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

    // Run the dev loop
    const result = await runDevLoop({
      job,
      supabaseUrl,
      supabaseServiceKey: supabaseKey,
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      maxTurnsPerLoop: parseInt(process.env.MAX_TURNS_PER_LOOP || '30'),
      testTimeoutSeconds: parseInt(process.env.TEST_TIMEOUT_SECONDS || '300'),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    })

    if (!shuttingDown) {
      await supabase
        .from('job_queue')
        .update({
          status: result.success ? 'succeeded' : 'failed',
          completed_at: new Date().toISOString(),
          total_cost_usd: result.totalCostUsd,
          pr_url: result.prUrl,
          error: result.error,
        })
        .eq('id', job.id)
    }

    console.log(
      `[queue-poller] Job ${job.id} completed: ${result.success ? 'succeeded' : 'failed'}`,
    )
  } catch (error) {
    if (shuttingDown) {
      console.log(`[queue-poller] Job ${job.id} interrupted by shutdown`)
      return
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Worker crashed unexpectedly'
    console.error(`[queue-poller] Job ${job.id} failed:`, errorMessage)

    await supabase
      .from('job_queue')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: errorMessage,
      })
      .eq('id', job.id)
  } finally {
    if (onJobEnd) onJobEnd(job.id)
    currentJob = null
    currentAbortController = null
  }
}

/**
 * Startup cleanup: reset stale claimed/running jobs from crashed workers.
 */
async function startupCleanup(): Promise<void> {
  if (!supabase) return

  console.log('[queue-poller] Running startup cleanup...')

  // 1. Reset jobs claimed by this worker that never started running
  const { data: staleClaimed } = await supabase
    .from('job_queue')
    .select('id')
    .eq('status', 'claimed')
    .eq('worker_id', WORKER_ID)

  if (staleClaimed && staleClaimed.length > 0) {
    console.log(
      `[queue-poller] Resetting ${staleClaimed.length} stale claimed job(s) from this worker`,
    )
    for (const job of staleClaimed) {
      await supabase
        .from('job_queue')
        .update({
          status: 'queued',
          worker_id: null,
          claimed_at: null,
        })
        .eq('id', job.id)
    }
  }

  // 2. Reset jobs claimed by ANY worker for too long
  const staleClaimedCutoff = new Date(
    Date.now() - STALE_CLAIMED_MS,
  ).toISOString()
  const { data: abandonedClaimed } = await supabase
    .from('job_queue')
    .select('id, worker_id')
    .eq('status', 'claimed')
    .lt('claimed_at', staleClaimedCutoff)

  if (abandonedClaimed && abandonedClaimed.length > 0) {
    console.log(
      `[queue-poller] Resetting ${abandonedClaimed.length} abandoned claimed job(s)`,
    )
    for (const job of abandonedClaimed) {
      await supabase
        .from('job_queue')
        .update({
          status: 'queued',
          worker_id: null,
          claimed_at: null,
          error: `Reset: claimed by ${job.worker_id} but never started`,
        })
        .eq('id', job.id)
    }
  }

  // 3. Reset jobs stuck in 'running' for too long
  const staleRunningCutoff = new Date(
    Date.now() - STALE_RUNNING_MS,
  ).toISOString()
  const { data: abandonedRunning } = await supabase
    .from('job_queue')
    .select('id, attempt, max_attempts, worker_id')
    .eq('status', 'running')
    .lt('started_at', staleRunningCutoff)

  if (abandonedRunning && abandonedRunning.length > 0) {
    console.log(
      `[queue-poller] Found ${abandonedRunning.length} abandoned running job(s)`,
    )
    for (const job of abandonedRunning) {
      if (job.attempt < job.max_attempts) {
        await supabase
          .from('job_queue')
          .update({
            status: 'queued',
            worker_id: null,
            claimed_at: null,
            started_at: null,
            attempt: job.attempt + 1,
            error: `Re-queued: abandoned running job (attempt ${job.attempt + 1}/${job.max_attempts})`,
          })
          .eq('id', job.id)
      } else {
        await supabase
          .from('job_queue')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: `Failed: abandoned after ${job.max_attempts} attempts`,
          })
          .eq('id', job.id)
      }
    }
  }

  console.log('[queue-poller] Startup cleanup complete')
}

async function emitEvent(
  sb: SupabaseClient,
  jobId: string,
  eventType: string,
  loopNumber?: number,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from('job_events').insert({
    job_id: jobId,
    event_type: eventType,
    loop_number: loopNumber,
    payload,
  })
  if (error) {
    console.error(
      `[queue-poller] Failed to insert ${eventType} event:`,
      error.message,
    )
  }
}
