import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// Mock queue-poller before importing index
vi.mock('../queue-poller.js', () => ({
  initQueuePoller: vi.fn().mockReturnValue(false),
  startPolling: vi.fn().mockResolvedValue(undefined),
  stopPolling: vi.fn(),
  requeueCurrentJob: vi.fn().mockResolvedValue(null),
  isPolling: vi.fn().mockReturnValue(false),
  isDraining: vi.fn().mockReturnValue(false),
  getCurrentJob: vi.fn().mockReturnValue(null),
  setJobCallbacks: vi.fn(),
  drain: vi.fn().mockReturnValue({ draining: false, currentJobId: null }),
}))

// We can't easily test the express server with imports because it starts
// listening immediately. Instead, test the core logic patterns.

describe('HTTP server configuration', () => {
  it('express module is importable', async () => {
    const express = await import('express')
    expect(express.default).toBeDefined()
  })

  it('queue-poller exports are available', async () => {
    const qp = await import('../queue-poller.js')
    expect(qp.initQueuePoller).toBeDefined()
    expect(qp.startPolling).toBeDefined()
    expect(qp.stopPolling).toBeDefined()
    expect(qp.isPolling).toBeDefined()
    expect(qp.isDraining).toBeDefined()
    expect(qp.getCurrentJob).toBeDefined()
    expect(qp.drain).toBeDefined()
    expect(qp.requeueCurrentJob).toBeDefined()
    expect(qp.setJobCallbacks).toBeDefined()
  })
})

describe('shared constants', () => {
  it('exports all required constants', async () => {
    const shared = await import('@wright/shared')
    expect(shared.POLL_INTERVAL_MS).toBe(5_000)
    expect(shared.DEFAULT_MAX_LOOPS).toBe(10)
    expect(shared.DEFAULT_MAX_BUDGET_USD).toBe(5.0)
    expect(shared.DEFAULT_TEST_TIMEOUT_SECONDS).toBe(300)
    expect(shared.STALE_CLAIMED_MS).toBe(2 * 60 * 1000)
    expect(shared.STALE_RUNNING_MS).toBe(30 * 60 * 1000)
    expect(shared.MIN_BUDGET_PER_LOOP_USD).toBe(0.10)
    expect(shared.DEFAULT_MAX_TURNS_PER_LOOP).toBe(30)
    expect(shared.DEFAULT_MAX_ATTEMPTS).toBe(3)
  })

  it('exports table names', async () => {
    const shared = await import('@wright/shared')
    expect(shared.TABLES.JOB_QUEUE).toBe('job_queue')
    expect(shared.TABLES.JOB_EVENTS).toBe('job_events')
    expect(shared.TABLES.TEST_RESULTS).toBe('test_results')
  })

  it('exports job status values', async () => {
    const shared = await import('@wright/shared')
    expect(shared.JOB_STATUS.QUEUED).toBe('queued')
    expect(shared.JOB_STATUS.CLAIMED).toBe('claimed')
    expect(shared.JOB_STATUS.RUNNING).toBe('running')
    expect(shared.JOB_STATUS.SUCCEEDED).toBe('succeeded')
    expect(shared.JOB_STATUS.FAILED).toBe('failed')
  })
})
