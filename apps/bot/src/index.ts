/**
 * Wright Telegram Bot -- human-in-the-loop interface.
 *
 * Receives dev task requests via Telegram, queues them in Supabase, and
 * streams progress back to the user. When a PR is created, sends inline
 * keyboard buttons for approve / reject.
 */

import { execFileSync } from 'child_process'
import { Bot, InlineKeyboard, type Context } from 'grammy'
import { JOB_STATUS, REAPER_INTERVAL_MS, STALE_HEARTBEAT_MS, STALE_CLAIMED_MS, type Job, type JobEvent } from '@wright/shared'
import {
  getSupabase,
  insertJob,
  getJob,
  getJobByPrefix,
  cancelJob,
  getJobEvents,
  subscribeToJobEvents,
  subscribeToJobUpdates,
} from './supabase.js'

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN
if (!BOT_TOKEN) {
  console.error('Fatal: BOT_TOKEN environment variable is not set.')
  process.exit(1)
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
if (!GITHUB_TOKEN) {
  console.error('Fatal: GITHUB_TOKEN environment variable is not set.')
  process.exit(1)
}

const WORKER_URL = process.env.WORKER_URL || 'https://wright-worker.fly.dev'

/**
 * Wake the worker by hitting its health endpoint.
 * This triggers Fly.io auto-start if the machine is stopped.
 * Errors are silently ignored — the request just needs to reach Fly's proxy.
 */
async function wakeWorker(): Promise<void> {
  try {
    await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) })
    console.log('[wake] Worker pinged successfully')
  } catch {
    // Ignore — the request just needs to trigger Fly.io auto-start.
    // The machine may take a few seconds to boot, so a timeout is expected.
    console.log('[wake] Worker ping sent (may be booting)')
  }
}

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const bot = new Bot(BOT_TOKEN)

// ---------------------------------------------------------------------------
// Notification mode: 'verbose' (default) or 'quiet', keyed by chat ID
// ---------------------------------------------------------------------------

// TODO: persist to Supabase so mode survives bot restarts
const chatNotifyMode = new Map<number, 'verbose' | 'quiet'>()

/** Events that are skipped entirely in quiet mode. */
const QUIET_EVENTS = new Set(['edit', 'test_run', 'cloned'])

/** Events that always deliver with notification sound regardless of mode. */
const LOUD_EVENTS = new Set(['pr_created', 'completed'])

// ---------------------------------------------------------------------------
// Authorization middleware — restrict to known Telegram users
// ---------------------------------------------------------------------------

const ALLOWED_TELEGRAM_USERS = process.env.ALLOWED_TELEGRAM_USERS
  ? process.env.ALLOWED_TELEGRAM_USERS.split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter(Number.isFinite)
  : []

if (ALLOWED_TELEGRAM_USERS.length > 0) {
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId || !ALLOWED_TELEGRAM_USERS.includes(userId)) {
      await ctx.reply('Unauthorized. Your user ID: ' + (userId ?? 'unknown'))
      return
    }
    await next()
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Job into a human-readable status block. */
function formatJobStatus(job: Job): string {
  const statusEmoji: Record<string, string> = {
    queued: '\u{1F7E1}',   // yellow circle
    claimed: '\u{1F535}',   // blue circle
    running: '\u{1F7E2}',   // green circle
    succeeded: '\u{2705}',  // check mark
    failed: '\u{274C}',     // cross mark
  }

  const icon = statusEmoji[job.status] ?? '\u{2753}'

  const lines = [
    `${icon} <b>Job ${job.id.slice(0, 8)}</b>`,
    `<b>Status:</b> ${job.status}`,
    `<b>Repo:</b> <code>${job.repo_url}</code>`,
    `<b>Task:</b> ${escapeHtml(job.task)}`,
    `<b>Cost:</b> $${job.total_cost_usd.toFixed(4)}`,
  ]

  if (job.pr_url) {
    lines.push(`<b>PR:</b> ${job.pr_url}`)
  }
  if (job.error) {
    lines.push(`<b>Error:</b> <code>${escapeHtml(job.error)}</code>`)
  }
  if (job.completed_at) {
    lines.push(`<b>Completed:</b> ${job.completed_at}`)
  }

  return lines.join('\n')
}

/** Format a JobEvent into a one-line progress message. */
function formatJobEvent(event: JobEvent): string {
  const typeLabels: Record<string, string> = {
    claimed: '\u{1F4CB} Job claimed by worker',
    cloned: '\u{1F4E5} Repository cloned',
    loop_start: `\u{1F504} Loop ${event.loop_number ?? '?'} started`,
    edit: '\u{270F}\u{FE0F} Files edited',
    test_run: '\u{1F9EA} Running tests...',
    test_pass: '\u{2705} Tests passed!',
    test_fail: '\u{274C} Tests failed',
    pr_created: '\u{1F389} Pull request created!',
    completed: '\u{2705} Job completed successfully',
    error: '\u{1F6A8} Error occurred',
    budget_exceeded: '\u{1F4B8} Budget limit exceeded',
  }

  let text = typeLabels[event.event_type] ?? `Event: ${event.event_type}`

  // Append payload summary for certain event types
  if (event.event_type === 'test_fail' && event.payload) {
    const p = event.payload as Record<string, unknown>
    if (p.passed !== undefined && p.failed !== undefined) {
      text += ` (${p.passed} passed, ${p.failed} failed)`
    }
  }
  if (event.event_type === 'error' && event.payload) {
    const p = event.payload as Record<string, unknown>
    if (p.message) {
      text += `: ${String(p.message).slice(0, 200)}`
    }
  }

  return text
}

/** Escape HTML special characters for Telegram HTML parse mode. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Validate a URL loosely -- must look like a git-cloneable repository. */
function isValidRepoUrl(url: string): boolean {
  try {
    // Accept https:// URLs and git@ SSH URLs
    if (url.startsWith('git@')) return true
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Extract a job ID from a bot message (looks for patterns like "Job ID: <uuid>"
 * or "[<short-id>]" in the message text).
 */
function extractJobIdFromMessage(text: string): string | null {
  // Full UUID pattern: "Job ID: xxxxxxxx-xxxx-..."
  const fullMatch = text.match(/Job ID:\s*([0-9a-f-]{36})/i)
  if (fullMatch) return fullMatch[1]
  // Full UUID inside "Job xxxxxxxx" (short ID in status messages)
  const shortMatch = text.match(/Job\s+([0-9a-f]{8})\b/i)
  if (shortMatch) return shortMatch[1]
  // Bracket prefix: "[xxxxxxxx]"
  const bracketMatch = text.match(/\[([0-9a-f]{8})\]/)
  if (bracketMatch) return bracketMatch[1]
  return null
}

/**
 * Parse a GitHub PR URL into its owner, repo, and PR number components.
 *
 * Accepts URLs like: https://github.com/owner/repo/pull/123
 */
function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

/**
 * Merge a pull request via the GitHub REST API.
 */
async function mergePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        merge_method: 'squash',
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub merge failed (${res.status}): ${body}`)
  }
}

/**
 * Close a pull request via the GitHub REST API (without merging).
 */
async function closePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        state: 'closed',
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub close failed (${res.status}): ${body}`)
  }
}

/** Build PR approval inline keyboard. */
function buildPrKeyboard(jobId: string, prUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url('View PR', prUrl)
    .row()
    .text('\u{2705} Approve & Merge', `approve:${jobId}`)
    .text('\u{274C} Reject & Close', `reject:${jobId}`)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.command('start', async (ctx: Context) => {
  await ctx.reply(
    [
      '<b>Wright Dev Automation Bot</b>',
      '',
      'I automate dev tasks: clone a repo, apply changes with Claude, run tests, and create a PR.',
      '',
      '<b>Commands:</b>',
      '/task &lt;repo_url&gt; &lt;description&gt; -- Submit a dev task',
      '/task &lt;pr_url&gt; &lt;feedback&gt; -- Revise an existing PR',
      '/revise &lt;job_id&gt; &lt;feedback&gt; -- Revise a job\'s PR',
      '/status &lt;job_id&gt; -- Check job status',
      '/cancel &lt;job_id&gt; -- Cancel a running job',
      '/verbose -- Enable all event notifications (default)',
      '/quiet -- Only send milestone notifications; silence noisy events',
      '',
      'You can also <b>reply</b> to any job message with feedback to revise its PR.',
      '',
      'When a PR is ready, I will send approve/reject buttons.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  )
})

bot.command('verbose', async (ctx: Context) => {
  const chatId = ctx.chat!.id
  chatNotifyMode.set(chatId, 'verbose')
  await ctx.reply('\u{1F50A} Verbose mode enabled. You will receive all event notifications.')
})

bot.command('quiet', async (ctx: Context) => {
  const chatId = ctx.chat!.id
  chatNotifyMode.set(chatId, 'quiet')
  await ctx.reply(
    '\u{1F514} Quiet mode enabled. '
      + 'Only milestone notifications (loop start, test results, PR created, completed, errors) will be sent. '
      + 'Noisy events (edits, test runs, cloned) are silenced.',
  )
})

bot.command('revise', async (ctx: Context) => {
  const text = ctx.message?.text ?? ''
  const parts = text.split(/\s+/)

  if (parts.length < 3) {
    await ctx.reply(
      'Usage: <code>/revise &lt;job_id&gt; &lt;feedback&gt;</code>\n\n'
        + 'Pushes changes to the existing PR branch based on your feedback.',
      { parse_mode: 'HTML' },
    )
    return
  }

  const jobIdInput = parts[1]
  const feedback = parts.slice(2).join(' ')

  try {
    // Look up the original job — support both full UUID and 8-char prefix
    const originalJob = await getJob(jobIdInput) ?? await getJobByPrefix(jobIdInput)
    if (!originalJob) {
      await ctx.reply(
        `No job found with ID <code>${escapeHtml(jobIdInput)}</code>.`,
        { parse_mode: 'HTML' },
      )
      return
    }

    if (!originalJob.pr_url) {
      await ctx.reply('That job has no PR yet. Cannot revise.')
      return
    }

    // Determine the feature branch from the original job
    const featureBranch = originalJob.feature_branch || `wright/${originalJob.id.slice(0, 8)}`

    const ack = await ctx.reply(
      `\u{1F504} Queuing revision for <code>${featureBranch}</code>...`,
      { parse_mode: 'HTML' },
    )

    const job = await insertJob({
      repoUrl: originalJob.repo_url,
      task: feedback,
      chatId: ctx.chat!.id,
      messageId: ack.message_id,
      githubToken: GITHUB_TOKEN,
      branch: originalJob.branch,
      featureBranch,
      parentJobId: originalJob.id,
    })

    // Wake the worker so it picks up the revision job
    wakeWorker()

    await ctx.reply(
      [
        '\u{1F504} <b>Revision queued!</b>',
        '',
        `<b>Job ID:</b> <code>${job.id}</code>`,
        `<b>Revising:</b> <code>${originalJob.id.slice(0, 8)}</code>`,
        `<b>Branch:</b> <code>${featureBranch}</code>`,
        `<b>Feedback:</b> ${escapeHtml(feedback)}`,
        '',
        'The worker will push changes to the existing PR branch.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.reply(
      `\u{274C} Failed to queue revision: <code>${escapeHtml(msg)}</code>`,
      { parse_mode: 'HTML' },
    )
  }
})

bot.command('task', async (ctx: Context) => {
  const text = ctx.message?.text ?? ''
  // Parse: /task <repo_url> <description...>
  // The command itself may include @botname, so split on whitespace
  const parts = text.split(/\s+/)
  // parts[0] = "/task" or "/task@botname"

  if (parts.length < 3) {
    await ctx.reply(
      'Usage: <code>/task &lt;repo_url&gt; &lt;description&gt;</code>\n\n'
        + 'Example:\n'
        + '<code>/task https://github.com/org/repo Fix the login button styling</code>',
      { parse_mode: 'HTML' },
    )
    return
  }

  const urlArg = parts[1]
  const description = parts.slice(2).join(' ')

  // Detect PR URL — treat as revision of that PR
  const prInfo = parsePrUrl(urlArg)
  if (prInfo) {
    if (description.length < 5) {
      await ctx.reply('Please provide feedback for the PR revision (at least 5 characters).')
      return
    }

    const ack = await ctx.reply(
      `\u{1F504} Detected PR #${prInfo.number}. Queuing revision...`,
      { parse_mode: 'HTML' },
    )

    try {
      // Look up the PR's head branch via GitHub API
      const ghEnv: Record<string, string> = {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME || '/home/wright',
      }
      if (GITHUB_TOKEN) ghEnv.GH_TOKEN = GITHUB_TOKEN

      const nwo = `${prInfo.owner}/${prInfo.repo}`
      const headRef = execFileSync(
        'gh',
        ['api', `repos/${nwo}/pulls/${prInfo.number}`, '--jq', '.head.ref'],
        { encoding: 'utf-8', env: ghEnv },
      ).trim()

      // Try to find the original job that created this branch so we can link them
      const { getSupabase } = await import('./supabase.js')
      const sb = getSupabase()
      const { data: parentJobs } = await sb
        .from('job_queue')
        .select('id')
        .or(`feature_branch.eq.${headRef},id.like.${headRef.replace('wright/', '')}%`)
        .not('pr_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
      const parentJobId = parentJobs?.[0]?.id

      const job = await insertJob({
        repoUrl: `https://github.com/${prInfo.owner}/${prInfo.repo}`,
        task: description,
        chatId: ctx.chat!.id,
        messageId: ack.message_id,
        githubToken: GITHUB_TOKEN,
        featureBranch: headRef,
        parentJobId,
      })

      // Wake the worker so it picks up the PR revision job
      wakeWorker()

      await ctx.reply(
        [
          '\u{1F504} <b>PR revision queued!</b>',
          '',
          `<b>Job ID:</b> <code>${job.id}</code>`,
          `<b>PR:</b> #${prInfo.number}`,
          `<b>Branch:</b> <code>${headRef}</code>`,
          `<b>Feedback:</b> ${escapeHtml(description)}`,
          '',
          'The worker will push changes to the existing PR branch.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await ctx.reply(
        `\u{274C} Failed to queue PR revision: <code>${escapeHtml(msg)}</code>`,
        { parse_mode: 'HTML' },
      )
    }
    return
  }

  // Normal task: repo URL + description
  const repoUrl = urlArg

  if (!isValidRepoUrl(repoUrl)) {
    await ctx.reply(
      'That does not look like a valid repository URL. '
        + 'Please provide an HTTPS or git@ URL.',
    )
    return
  }

  if (description.length < 5) {
    await ctx.reply('Please provide a more detailed task description (at least 5 characters).')
    return
  }

  // Send an acknowledgment message first -- we will store its message_id
  const ack = await ctx.reply(
    `\u{23F3} Queuing task for <code>${escapeHtml(repoUrl)}</code>...`,
    { parse_mode: 'HTML' },
  )

  try {
    const job = await insertJob({
      repoUrl,
      task: description,
      chatId: ctx.chat!.id,
      messageId: ack.message_id,
      githubToken: GITHUB_TOKEN,
    })

    // Wake the worker so it picks up the new job
    wakeWorker()

    await ctx.reply(
      [
        '\u{2705} <b>Job queued!</b>',
        '',
        `<b>Job ID:</b> <code>${job.id}</code>`,
        `<b>Repo:</b> <code>${escapeHtml(job.repo_url)}</code>`,
        `<b>Task:</b> ${escapeHtml(job.task)}`,
        `<b>Max loops:</b> ${job.max_loops}`,
        `<b>Budget:</b> $${job.max_budget_usd.toFixed(2)}`,
        '',
        'I will notify you as the worker picks it up and makes progress.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.reply(
      `\u{274C} Failed to queue job: <code>${escapeHtml(msg)}</code>`,
      { parse_mode: 'HTML' },
    )
  }
})

bot.command('status', async (ctx: Context) => {
  const text = ctx.message?.text ?? ''
  const parts = text.split(/\s+/)

  if (parts.length < 2) {
    await ctx.reply(
      'Usage: <code>/status &lt;job_id&gt;</code>',
      { parse_mode: 'HTML' },
    )
    return
  }

  const jobId = parts[1]

  try {
    const job = await getJob(jobId)

    if (!job) {
      await ctx.reply(`No job found with ID <code>${escapeHtml(jobId)}</code>.`, {
        parse_mode: 'HTML',
      })
      return
    }

    let reply = formatJobStatus(job)

    // Append recent events
    const events = await getJobEvents(jobId, 10)
    if (events.length > 0) {
      reply += '\n\n<b>Recent events:</b>\n'
      reply += events.map((e) => `  ${formatJobEvent(e)}`).join('\n')
    }

    // If there is a PR, include approve/reject buttons
    if (job.pr_url && job.status === JOB_STATUS.SUCCEEDED) {
      await ctx.reply(reply, {
        parse_mode: 'HTML',
        reply_markup: buildPrKeyboard(job.id, job.pr_url),
      })
    } else {
      await ctx.reply(reply, { parse_mode: 'HTML' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.reply(
      `\u{274C} Error fetching status: <code>${escapeHtml(msg)}</code>`,
      { parse_mode: 'HTML' },
    )
  }
})

bot.command('cancel', async (ctx: Context) => {
  const text = ctx.message?.text ?? ''
  const parts = text.split(/\s+/)

  if (parts.length < 2) {
    await ctx.reply(
      'Usage: <code>/cancel &lt;job_id&gt;</code>',
      { parse_mode: 'HTML' },
    )
    return
  }

  const jobId = parts[1]

  try {
    const job = await cancelJob(jobId)

    if (!job) {
      await ctx.reply(
        `Could not cancel job <code>${escapeHtml(jobId)}</code>. `
          + 'It may have already completed or does not exist.',
        { parse_mode: 'HTML' },
      )
      return
    }

    await ctx.reply(
      `\u{1F6D1} Job <code>${job.id.slice(0, 8)}</code> has been cancelled.`,
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.reply(
      `\u{274C} Error cancelling job: <code>${escapeHtml(msg)}</code>`,
      { parse_mode: 'HTML' },
    )
  }
})

// ---------------------------------------------------------------------------
// Reply-based revision — reply to any job message to revise the PR
// ---------------------------------------------------------------------------

bot.on('message:text', async (ctx, next) => {
  const reply = ctx.message.reply_to_message
  // Only handle replies to bot messages that contain a job ID
  if (!reply || reply.from?.id !== ctx.me.id) {
    return next()
  }

  const replyText = reply.text || reply.caption || ''
  const jobIdPrefix = extractJobIdFromMessage(replyText)
  if (!jobIdPrefix) return next()

  const feedback = ctx.message.text
  // Ignore commands — let command handlers take care of those
  if (feedback.startsWith('/')) return next()

  if (feedback.length < 5) {
    await ctx.reply('Please provide more detailed feedback (at least 5 characters).')
    return
  }

  try {
    // Look up the original job — try full ID first, then prefix match
    const originalJob = await getJob(jobIdPrefix) ?? await getJobByPrefix(jobIdPrefix)
    if (!originalJob) {
      await ctx.reply(
        `Could not find job <code>${escapeHtml(jobIdPrefix)}</code>.`,
        { parse_mode: 'HTML' },
      )
      return
    }

    if (!originalJob.pr_url) {
      await ctx.reply('That job has no PR yet. Cannot revise.')
      return
    }

    const featureBranch = originalJob.feature_branch || `wright/${originalJob.id.slice(0, 8)}`

    const ack = await ctx.reply(
      `\u{1F504} Queuing revision for <code>${featureBranch}</code> based on your reply...`,
      { parse_mode: 'HTML' },
    )

    const job = await insertJob({
      repoUrl: originalJob.repo_url,
      task: feedback,
      chatId: ctx.chat!.id,
      messageId: ack.message_id,
      githubToken: GITHUB_TOKEN,
      branch: originalJob.branch,
      featureBranch,
      parentJobId: originalJob.id,
    })

    // Wake the worker so it picks up the revision job
    wakeWorker()

    await ctx.reply(
      [
        '\u{1F504} <b>Revision queued from reply!</b>',
        '',
        `<b>Job ID:</b> <code>${job.id}</code>`,
        `<b>Revising:</b> <code>${originalJob.id.slice(0, 8)}</code>`,
        `<b>Branch:</b> <code>${featureBranch}</code>`,
        `<b>Feedback:</b> ${escapeHtml(feedback.slice(0, 200))}`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.reply(
      `\u{274C} Failed to queue revision: <code>${escapeHtml(msg)}</code>`,
      { parse_mode: 'HTML' },
    )
  }
})

// ---------------------------------------------------------------------------
// Inline keyboard callback queries (approve / reject PRs)
// ---------------------------------------------------------------------------

bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  const jobId = ctx.match![1]

  try {
    const job = await getJob(jobId)
    if (!job || !job.pr_url) {
      await ctx.answerCallbackQuery({ text: 'Job or PR not found.' })
      return
    }

    const parsed = parsePrUrl(job.pr_url)
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: 'Could not parse PR URL.' })
      return
    }

    await ctx.answerCallbackQuery({ text: 'Merging PR...' })

    await mergePullRequest(parsed.owner, parsed.repo, parsed.number)

    await ctx.editMessageText(
      [
        `\u{2705} <b>PR merged successfully</b>`,
        '',
        `<b>Job:</b> <code>${job.id.slice(0, 8)}</code>`,
        `<b>PR:</b> ${job.pr_url}`,
        '',
        `Merged <code>${parsed.owner}/${parsed.repo}#${parsed.number}</code> via squash merge.`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.answerCallbackQuery({
      text: `Error: ${msg.slice(0, 180)}`,
      show_alert: true,
    })
  }
})

bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  const jobId = ctx.match![1]

  try {
    const job = await getJob(jobId)
    if (!job || !job.pr_url) {
      await ctx.answerCallbackQuery({ text: 'Job or PR not found.' })
      return
    }

    const parsed = parsePrUrl(job.pr_url)
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: 'Could not parse PR URL.' })
      return
    }

    await ctx.answerCallbackQuery({ text: 'Closing PR...' })

    await closePullRequest(parsed.owner, parsed.repo, parsed.number)

    await ctx.editMessageText(
      [
        `\u{274C} <b>PR rejected and closed</b>`,
        '',
        `<b>Job:</b> <code>${job.id.slice(0, 8)}</code>`,
        `<b>PR:</b> ${job.pr_url}`,
        '',
        `Closed <code>${parsed.owner}/${parsed.repo}#${parsed.number}</code> without merging.`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await ctx.answerCallbackQuery({
      text: `Error: ${msg.slice(0, 180)}`,
      show_alert: true,
    })
  }
})

// ---------------------------------------------------------------------------
// Supabase realtime -> Telegram bridge
// ---------------------------------------------------------------------------

/**
 * Forward job events to the originating Telegram chat.
 *
 * When a job has telegram_chat_id set, each new event is sent as a message
 * to that chat. PR creation events include the inline approval keyboard.
 */
function startRealtimeBridge(): void {
  // Stream individual events
  subscribeToJobEvents(async (event: JobEvent) => {
    try {
      // Look up the job to find the chat ID
      const job = await getJob(event.job_id)
      if (!job?.telegram_chat_id) return

      const chatId = job.telegram_chat_id
      const mode = chatNotifyMode.get(chatId) ?? 'verbose'

      // In quiet mode, skip noisy events entirely
      if (mode === 'quiet' && QUIET_EVENTS.has(event.event_type)) return

      const text = `<b>[${job.id.slice(0, 8)}]</b> ${formatJobEvent(event)}`

      // In quiet mode, deliver silently unless this is a loud event
      const disableNotification = mode === 'quiet' && !LOUD_EVENTS.has(event.event_type)

      // PR created events get the approval keyboard
      if (event.event_type === 'pr_created' && job.pr_url) {
        await bot.api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: buildPrKeyboard(job.id, job.pr_url),
          disable_notification: disableNotification,
        })
      } else {
        await bot.api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          disable_notification: disableNotification,
        })
      }
    } catch (err) {
      // Log but do not crash -- the subscription must stay alive
      console.error('Error forwarding job event to Telegram:', err)
    }
  })

  // Stream status changes (for terminal states)
  subscribeToJobUpdates(async (job: Job) => {
    if (!job.telegram_chat_id) return

    const terminal = [JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED] as string[]
    if (!terminal.includes(job.status)) return

    try {
      const chatId = job.telegram_chat_id
      const mode = chatNotifyMode.get(chatId) ?? 'verbose'
      const text = formatJobStatus(job)

      if (job.pr_url && job.status === JOB_STATUS.SUCCEEDED) {
        await bot.api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: buildPrKeyboard(job.id, job.pr_url),
        })
      } else {
        // Terminal failure: respect quiet mode (silent delivery)
        const disableNotification = mode === 'quiet' && job.status === JOB_STATUS.FAILED
        await bot.api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          disable_notification: disableNotification,
        })
      }
    } catch (err) {
      console.error('Error forwarding job status update to Telegram:', err)
    }
  })

  console.log('Supabase realtime bridge started.')
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

bot.catch((err) => {
  console.error('Unhandled bot error:', err)
})

// ---------------------------------------------------------------------------
// Stale job reaper — detects dead workers via heartbeat expiry
// ---------------------------------------------------------------------------

function startReaper(): void {
  const sb = getSupabase()

  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString()

      // Find running jobs with stale or missing heartbeats
      const { data: staleJobs, error } = await sb
        .from('job_queue')
        .select('id, attempt, max_attempts, worker_id, telegram_chat_id, task, heartbeat_at, started_at')
        .eq('status', 'running')
        .or(`heartbeat_at.lt.${cutoff},and(heartbeat_at.is.null,started_at.lt.${cutoff})`)

      if (error) {
        console.error('[reaper] Query error:', error.message)
        return
      }

      if (!staleJobs || staleJobs.length === 0) return

      console.log(`[reaper] Found ${staleJobs.length} stale running job(s)`)

      for (const job of staleJobs) {
        if (job.attempt < job.max_attempts) {
          // Re-queue for retry
          const { data: updated } = await sb
            .from('job_queue')
            .update({
              status: 'queued',
              worker_id: null,
              claimed_at: null,
              started_at: null,
              heartbeat_at: null,
              attempt: job.attempt + 1,
              error: `Re-queued by reaper: worker stopped responding (attempt ${job.attempt + 1}/${job.max_attempts})`,
            })
            .eq('id', job.id)
            .eq('status', 'running')  // CAS: only if still running
            .select('id')

          if (updated && updated.length > 0) {
            console.log(`[reaper] Re-queued job ${job.id} (attempt ${job.attempt + 1}/${job.max_attempts})`)

            if (job.telegram_chat_id) {
              try {
                await bot.api.sendMessage(
                  job.telegram_chat_id,
                  `<b>[${job.id.slice(0, 8)}]</b> Worker stopped responding. `
                    + `Re-queuing automatically (attempt ${job.attempt + 1}/${job.max_attempts}).`,
                  { parse_mode: 'HTML' },
                )
              } catch {
                // Best effort notification
              }
            }

            wakeWorker()
          }
        } else {
          // Max attempts exceeded — mark as permanently failed
          const { data: updated } = await sb
            .from('job_queue')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              heartbeat_at: null,
              error: `Failed: worker stopped responding after ${job.max_attempts} attempts`,
            })
            .eq('id', job.id)
            .eq('status', 'running')  // CAS

          if (updated && updated.length > 0) {
            console.log(`[reaper] Job ${job.id} permanently failed (max attempts)`)

            if (job.telegram_chat_id) {
              try {
                await bot.api.sendMessage(
                  job.telegram_chat_id,
                  `<b>[${job.id.slice(0, 8)}]</b> Worker stopped responding. `
                    + `Job has failed permanently after ${job.max_attempts} attempts.`,
                  { parse_mode: 'HTML' },
                )
              } catch {
                // Best effort notification
              }
            }
          }
        }
      }

      // Also check for stale claimed jobs (worker died before transitioning to running)
      const claimedCutoff = new Date(Date.now() - STALE_CLAIMED_MS).toISOString()
      const { data: staleClaimed } = await sb
        .from('job_queue')
        .select('id, worker_id')
        .eq('status', 'claimed')
        .lt('claimed_at', claimedCutoff)

      if (staleClaimed && staleClaimed.length > 0) {
        for (const job of staleClaimed) {
          await sb
            .from('job_queue')
            .update({
              status: 'queued',
              worker_id: null,
              claimed_at: null,
              heartbeat_at: null,
              error: `Re-queued by reaper: claimed by ${job.worker_id} but never started`,
            })
            .eq('id', job.id)
            .eq('status', 'claimed')  // CAS

          console.log(`[reaper] Reset stale claimed job ${job.id}`)
        }
        wakeWorker()
      }
    } catch (err) {
      console.error('[reaper] Unexpected error:', err)
    }
  }, REAPER_INTERVAL_MS)

  console.log(
    `[reaper] Stale job reaper started (interval: ${REAPER_INTERVAL_MS}ms, staleness: ${STALE_HEARTBEAT_MS}ms)`,
  )
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Wright Telegram bot starting...')

  // Start the realtime bridge (Supabase -> Telegram).
  // This will throw if SUPABASE_URL / SUPABASE_KEY are missing, which is
  // intentional -- we want a loud failure at startup.
  startRealtimeBridge()

  // Start the stale job reaper — detects dead workers via heartbeat expiry
  startReaper()

  // Start long polling. This will block until the process is stopped.
  console.log('Bot is now polling for updates.')
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running.`)
    },
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
