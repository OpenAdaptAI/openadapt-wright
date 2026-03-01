/**
 * Wright Worker -- generalized dev automation loop.
 *
 * TODO: Implement the following:
 *
 * 1. Poll Supabase job_queue for 'queued' jobs
 * 2. Claim a job (atomic update status → 'claimed')
 * 3. Clone the target repo, create a feature branch
 * 4. Auto-detect test runner and package manager
 * 5. Install dependencies
 * 6. Ralph Loop:
 *    a. Invoke Claude Agent SDK with the task description + test failures
 *    b. Apply code edits
 *    c. Run tests
 *    d. If tests pass → create PR, mark job 'succeeded'
 *    e. If tests fail → feed failures back to Claude, loop
 *    f. If budget exceeded or max loops → mark job 'failed'
 * 7. Emit job_events for observability
 * 8. Notify via Crier (Telegram) on completion
 */

import { POLL_INTERVAL_MS } from '@wright/shared/constants'
import type { Job } from '@wright/shared/types'

console.log('Wright worker starting...')
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`)
console.log('TODO: implement job polling and dev loop')
