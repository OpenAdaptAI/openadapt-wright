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
 * How often the worker polls for new jobs (milliseconds).
 */
export const POLL_INTERVAL_MS = 5_000

/**
 * Maximum time a job can be claimed without progress before it's
 * considered stale and eligible for re-claiming (seconds).
 */
export const STALE_CLAIM_TIMEOUT_SECONDS = 600

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
