import express from 'express'
import {
  initQueuePoller,
  startPolling,
  stopPolling,
  requeueCurrentJob,
  isPolling,
  isDraining,
  getCurrentJob,
  setJobCallbacks,
  drain,
} from './queue-poller.js'

const app = express()
app.use(express.json())

const FLY_APP_NAME = process.env.FLY_APP_NAME || 'wright-worker'

// Track active jobs with AbortControllers for cancellation
const runningJobs = new Map<string, AbortController>()
let activeJobs = 0
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000 // 5 min idle → exit (scale-to-zero)
let idleTimer: ReturnType<typeof setTimeout> | null = null
let keepAliveInterval: ReturnType<typeof setInterval> | null = null

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  if (activeJobs === 0) {
    idleTimer = setTimeout(() => {
      console.log('No active jobs for 5 minutes, shutting down')
      process.exit(0)
    }, IDLE_SHUTDOWN_MS)
  }
}

// Self-ping through Fly.io proxy to prevent auto-stop while jobs are running.
function startKeepAlive() {
  if (keepAliveInterval) return
  keepAliveInterval = setInterval(async () => {
    try {
      await fetch(`https://${FLY_APP_NAME}.fly.dev/health`)
    } catch {
      // Best effort
    }
  }, 30_000)
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
}

// Wire up queue poller callbacks
setJobCallbacks({
  onJobStart: (jobId: string, controller: AbortController) => {
    runningJobs.set(jobId, controller)
    activeJobs++
    if (idleTimer) clearTimeout(idleTimer)
    startKeepAlive()
  },
  onJobEnd: (jobId: string) => {
    runningJobs.delete(jobId)
    activeJobs--
    if (activeJobs === 0) stopKeepAlive()
    resetIdleTimer()
  },
})

app.get('/', (_req, res) => {
  res.json({
    service: 'wright-worker',
    status: 'ok',
    activeJobs,
    polling: isPolling(),
    timestamp: new Date().toISOString(),
    endpoints: ['GET /health', 'POST /drain', 'POST /jobs/cancel'],
  })
})

app.get('/health', (req, res) => {
  const jobId = req.query.jobId as string | undefined
  const currentJob = getCurrentJob()

  if (jobId) {
    const isRunning = runningJobs.has(jobId)
    return res.json({
      status: 'ok',
      activeJobs,
      polling: isPolling(),
      queriedJobId: jobId,
      isRunningHere: isRunning,
      runningJobs: Array.from(runningJobs.keys()),
      currentQueueJob: currentJob?.id ?? null,
      timestamp: new Date().toISOString(),
    })
  }

  res.json({
    status: 'ok',
    activeJobs,
    polling: isPolling(),
    draining: isDraining(),
    runningJobs: Array.from(runningJobs.keys()),
    currentQueueJob: currentJob?.id ?? null,
    timestamp: new Date().toISOString(),
  })
})

// Drain mode: stop accepting new jobs, let current job finish.
app.post('/drain', (_req, res) => {
  const result = drain()
  console.log(
    `[drain] Drain mode activated. Current job: ${result.currentJobId ?? 'none'}`,
  )
  res.json({
    status: 'draining',
    ...result,
    activeJobs,
    message: result.draining
      ? `Draining — waiting for job ${result.currentJobId} to finish. Poll /health until activeJobs === 0.`
      : 'No active jobs. Safe to deploy.',
  })
})

app.post('/jobs/cancel', (req, res) => {
  const { jobId } = req.body || {}
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' })
  }
  const controller = runningJobs.get(jobId)
  if (controller) {
    controller.abort()
    runningJobs.delete(jobId)
    res.json({ status: 'cancelled', jobId })
  } else {
    res.status(404).json({
      error: 'Job not found',
      activeJobs: Array.from(runningJobs.keys()),
    })
  }
})

// Graceful shutdown — re-queue running jobs instead of marking failed
async function handleShutdown(signal: string) {
  console.log(`Received ${signal}, ${activeJobs} active jobs`)

  stopPolling()

  if (activeJobs === 0) {
    process.exit(0)
    return
  }

  const requeuedJobId = await requeueCurrentJob()
  if (requeuedJobId) {
    console.log(`[shutdown] Re-queued job ${requeuedJobId}`)
  }

  // Give a short window for DB writes, then exit
  setTimeout(() => process.exit(0), 3000)
}
process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`Wright worker listening on :${PORT}`)
  resetIdleTimer()

  const initialized = initQueuePoller()
  if (initialized) {
    startPolling().catch((err) =>
      console.error('[startup] Queue poller error:', err),
    )
  } else {
    console.warn(
      '[startup] Queue poller not initialized — worker will not process jobs automatically',
    )
  }
})
