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
  telegram_chat_id?: number
  telegram_message_id?: number
  created_at: string
  claimed_at?: string
  started_at?: string
  completed_at?: string
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
  /** Raw test runner output */
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
  /** Maximum number of edit-test-fix iterations */
  max_loops: number
  /** Maximum spend in USD before aborting */
  max_budget_usd: number
  /** Test runner to use (auto-detected if not specified) */
  test_runner?: TestRunner
  /** Package manager to use (auto-detected if not specified) */
  package_manager?: PackageManager
  /** Claude model to use */
  model: string
  /** Timeout per test run in seconds */
  test_timeout_seconds: number
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
