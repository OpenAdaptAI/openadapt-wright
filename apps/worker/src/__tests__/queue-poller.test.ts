import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock environment before imports
const originalEnv = { ...process.env }

describe('queue-poller state management', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('isPolling returns false before initialization', async () => {
    const { isPolling } = await import('../queue-poller.js')
    expect(isPolling()).toBe(false)
  })

  it('isDraining returns false before initialization', async () => {
    const { isDraining } = await import('../queue-poller.js')
    expect(isDraining()).toBe(false)
  })

  it('getCurrentJob returns null when idle', async () => {
    const { getCurrentJob } = await import('../queue-poller.js')
    expect(getCurrentJob()).toBeNull()
  })

  it('initQueuePoller returns false without env vars', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { initQueuePoller } = await import('../queue-poller.js')
    expect(initQueuePoller()).toBe(false)
  })

  it('drain returns no current job when idle', async () => {
    const { drain } = await import('../queue-poller.js')
    const result = drain()
    expect(result.draining).toBe(false)
    expect(result.currentJobId).toBeNull()
  })

  it('requeueCurrentJob returns null when no job running', async () => {
    const { requeueCurrentJob } = await import('../queue-poller.js')
    const result = await requeueCurrentJob()
    expect(result).toBeNull()
  })
})
