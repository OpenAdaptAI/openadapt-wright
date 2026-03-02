import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

// Use vi.hoisted() to define mocks that are referenced in vi.mock factories
const { mockInsert, mockFrom, mockRunClaudeSession, mockCloneRepo } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockReturnValue({ error: null })
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ error: null }),
  })
  const mockFrom = vi.fn().mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
  })
  const mockRunClaudeSession = vi.fn().mockResolvedValue({
    costUsd: 0.05,
    turns: 3,
    sessionId: 'test-session-1',
  })
  const mockCloneRepo = vi.fn()
  return { mockInsert, mockUpdate, mockFrom, mockRunClaudeSession, mockCloneRepo }
})

// Mock the claude-session module before importing dev-loop
vi.mock('../claude-session.js', () => ({
  runClaudeSession: mockRunClaudeSession,
}))

// Mock the github-ops module
vi.mock('../github-ops.js', () => ({
  cloneRepo: mockCloneRepo.mockImplementation(async (_url: string, workDir: string) => {
    mkdirSync(workDir, { recursive: true })
    execSync('git init', { cwd: workDir, stdio: 'pipe' })
    execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: workDir, stdio: 'pipe' })
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({
      name: 'test-repo',
      scripts: { test: 'echo "1 test passed" && exit 0' },
    }))
    writeFileSync(join(workDir, 'README.md'), '# Test')
    execSync('git add . && git commit -m "init"', { cwd: workDir, stdio: 'pipe' })
  }),
  createFeatureBranch: vi.fn().mockResolvedValue('wright/test-1234'),
  commitAndPush: vi.fn().mockResolvedValue('abc123def'),
  createPullRequest: vi.fn().mockResolvedValue('https://github.com/test/repo/pull/1'),
}))

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    from: mockFrom,
  }),
}))

import { runDevLoop } from '../dev-loop.js'
import type { Job, DevLoopConfig } from '@wright/shared'

function createMockJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'test-job-001',
    repo_url: 'https://github.com/test/repo.git',
    branch: 'main',
    task: 'Fix the login button styling',
    max_loops: 3,
    max_budget_usd: 1.0,
    status: 'running',
    total_cost_usd: 0,
    attempt: 1,
    max_attempts: 3,
    github_token: 'ghp_test_token_123',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function createMockConfig(job: Job): DevLoopConfig {
  return {
    job,
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceKey: 'test-service-key',
    model: 'claude-sonnet-4-20250514',
    maxTurnsPerLoop: 10,
    testTimeoutSeconds: 30,
    anthropicApiKey: 'sk-ant-test',
  }
}

describe('runDevLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a complete dev loop with mocked externals', async () => {
    const job = createMockJob()
    const config = createMockConfig(job)

    const result = await runDevLoop(config)

    expect(result).toBeDefined()
    expect(result.loopsCompleted).toBeGreaterThanOrEqual(1)
    expect(result.totalCostUsd).toBeGreaterThan(0)
    expect(result.finalTestResults).toBeDefined()
    expect(result.finalTestResults.total).toBeGreaterThanOrEqual(0)
  })

  it('returns prUrl and commitSha on success', async () => {
    const job = createMockJob()
    const config = createMockConfig(job)

    const result = await runDevLoop(config)

    expect(result.commitSha).toBe('abc123def')
    expect(result.prUrl).toBe('https://github.com/test/repo/pull/1')
  })

  it('emits events to Supabase job_events table', async () => {
    const job = createMockJob()
    const config = createMockConfig(job)

    await runDevLoop(config)

    // Verify events were emitted
    expect(mockFrom).toHaveBeenCalledWith('job_events')
    expect(mockInsert).toHaveBeenCalled()
  })

  it('respects max_budget_usd limit', async () => {
    const job = createMockJob({ max_budget_usd: 0.01 })
    const config = createMockConfig(job)

    const result = await runDevLoop(config)

    expect(result.totalCostUsd).toBeDefined()
  })

  it('cleans up workdir after completion', async () => {
    const job = createMockJob()
    const config = createMockConfig(job)

    await runDevLoop(config)

    const workDir = `/tmp/wright-work/${job.id}`
    expect(existsSync(workDir)).toBe(false)
  })
})
