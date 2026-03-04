/**
 * Supported test runners that wright can auto-detect and invoke.
 */
export type TestRunner =
  | 'pytest'
  | 'playwright'
  | 'jest'
  | 'vitest'
  | 'go-test'
  | 'cargo-test'
  | 'custom'

/**
 * Supported package managers for dependency installation.
 */
export type PackageManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'pip'
  | 'uv'
  | 'poetry'
  | 'cargo'
  | 'go'
  | 'none'

/**
 * A job in the wright queue. Represents a single dev automation task:
 * clone a repo, apply changes via Claude, run tests, create a PR.
 */
export interface Job {
  id: string
  repo_url: string
  branch: string
  task: string
  /** Auto-detected from repo if null */
  test_runner?: TestRunner
  /** Auto-detected from repo if null */
  package_manager?: PackageManager
  max_loops: number
  max_budget_usd: number
  status: 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed'
  worker_id?: string
  pr_url?: string
  total_cost_usd: number
  /** Current attempt number (1-based) */
  attempt: number
  /** Maximum retries on worker crash */
  max_attempts: number
  /** GitHub token for repo access */
  github_token: string

  /** For revision jobs: the existing feature branch to push to (e.g. wright/14da897c) */
  feature_branch?: string
  /** For revision jobs: the ID of the original job this is revising */
  parent_job_id?: string

  // Telegram integration
  telegram_chat_id?: number
  telegram_message_id?: number

  // Timestamps
  created_at: string
  claimed_at?: string
  started_at?: string
  completed_at?: string

  // Error details on failure
  error?: string
}

/**
 * Aggregated test results from a single test run.
 */
export interface TestResults {
  passed: number
  failed: number
  errors: number
  skipped: number
  total: number
  /** Duration in seconds */
  duration: number
  failures: TestFailure[]
  /** Raw test runner output (truncated) */
  raw?: string
}

/**
 * A single test failure with diagnostic information.
 */
export interface TestFailure {
  name: string
  message: string
  stdout?: string
}

/**
 * Configuration for the dev loop (Ralph Loop).
 */
export interface DevLoopConfig {
  job: Job
  supabaseUrl: string
  supabaseServiceKey: string
  /** Claude model to use */
  model: string
  /** Max turns per Claude session within a single loop */
  maxTurnsPerLoop: number
  /** Timeout per test run in seconds */
  testTimeoutSeconds: number
  /** Anthropic API key (uses env ANTHROPIC_API_KEY if not set) */
  anthropicApiKey?: string
  /** Abort controller for graceful cancellation (e.g. SIGTERM) */
  abortController?: AbortController
}

/**
 * Result of a completed dev loop.
 */
export interface DevLoopResult {
  success: boolean
  loopsCompleted: number
  totalCostUsd: number
  finalTestResults: TestResults
  prUrl?: string
  commitSha?: string
  error?: string
}

/**
 * Event emitted during job processing for observability.
 */
export interface JobEvent {
  id: string
  job_id: string
  event_type:
    | 'claimed'
    | 'cloned'
    | 'loop_start'
    | 'edit'
    | 'test_run'
    | 'test_pass'
    | 'test_fail'
    | 'pr_created'
    | 'completed'
    | 'error'
    | 'budget_exceeded'
  loop_number?: number
  payload?: Record<string, unknown>
  created_at: string
}
