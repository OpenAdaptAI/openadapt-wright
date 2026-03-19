/**
 * Default Claude model for the dev loop.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

/**
 * Maximum number of edit-test-fix loops before giving up.
 */
export const DEFAULT_MAX_LOOPS = 10

/**
 * Default budget cap per job in USD.
 */
export const DEFAULT_MAX_BUDGET_USD = 5.0

/**
 * Default timeout for a single test run in seconds.
 */
export const DEFAULT_TEST_TIMEOUT_SECONDS = 300

/**
 * Max turns per Claude session within a single loop iteration.
 */
export const DEFAULT_MAX_TURNS_PER_LOOP = 30

/**
 * Minimum budget remaining to start another loop (USD).
 */
export const MIN_BUDGET_PER_LOOP_USD = 0.10

/**
 * Default max retry attempts on worker crash.
 */
export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * How often the worker polls for new jobs (milliseconds).
 */
export const POLL_INTERVAL_MS = 5_000

/**
 * Time a job can sit in 'claimed' status before being considered stale (ms).
 * A claiming worker that crashes between claim and start leaves the job here.
 */
export const STALE_CLAIMED_MS = 2 * 60 * 1000  // 2 minutes

/**
 * Time a job can sit in 'running' status before being considered stale (ms).
 * A worker that crashes mid-job leaves it here.
 */
export const STALE_RUNNING_MS = 30 * 60 * 1000  // 30 minutes

/**
 * How often the worker sends a heartbeat while processing a job (ms).
 */
export const HEARTBEAT_INTERVAL_MS = 30_000  // 30 seconds

/**
 * How long a running job can go without a heartbeat before being
 * considered stale (ms). Must be > HEARTBEAT_INTERVAL_MS.
 *
 * Set to 3x the heartbeat interval to tolerate transient delays
 * (slow DB writes, GC pauses, etc.)
 */
export const STALE_HEARTBEAT_MS = 90_000  // 90 seconds

/**
 * How often the bot checks for stale running jobs (ms).
 */
export const REAPER_INTERVAL_MS = 60_000  // 60 seconds

/**
 * Supabase table names.
 */
export const TABLES = {
  JOB_QUEUE: 'job_queue',
  JOB_EVENTS: 'job_events',
  TEST_RESULTS: 'test_results',
} as const

/**
 * Job status values.
 */
export const JOB_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const
