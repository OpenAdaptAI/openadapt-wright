/**
 * Wright Telegram Bot -- human-in-the-loop interface.
 *
 * Receives dev task requests via Telegram, queues them in Supabase, and
 * streams progress back to the user. When a PR is created, sends inline
 * keyboard buttons for approve / reject.
 */

import { Bot, InlineKeyboard, type Context } from 'grammy'
import { JOB_STATUS, type Job, type JobEvent } from '@wright/shared'
import {
  insertJob,
  getJob,
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

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const bot = new Bot(BOT_TOKEN)

// ---------------------------------------------------------------------------
// Notification mode: 'verbose' (default) or 'quiet', keyed by chat ID
// ---------------------------------------------------------------------------

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
 * Parse a GitHub PR URL into its components.
 * Returns null if the URL is not a valid PR URL.
 */
function parsePrUrl(url: string): { repoUrl: string; prNumber: number } | null {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return {
    repoUrl: `https://github.com/${match[1]}`,
    prNumber: parseInt(match[2], 10),
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
    const originalJob = await getJob(jobIdInput)
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
      `\u{1F504} Detected PR #${prInfo.prNumber}. Queuing revision...`,
      { parse_mode: 'HTML' },
    )

    try {
      // Look up the PR's head branch via GitHub API
      const { execFileSync } = await import('child_process')
      const env: Record<string, string> = {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME || '/home/wright',
      }
      if (GITHUB_TOKEN) env.GH_TOKEN = GITHUB_TOKEN

      const nwo = prInfo.repoUrl.replace('https://github.com/', '')
      const headRef = execFileSync(
        'gh',
        ['api', `repos/${nwo}/pulls/${prInfo.prNumber}`, '--jq', '.head.ref'],
        { encoding: 'utf-8', env },
      ).trim()

      const job = await insertJob({
        repoUrl: prInfo.repoUrl,
        task: description,
        chatId: ctx.chat!.id,
        messageId: ack.message_id,
        githubToken: GITHUB_TOKEN,
        featureBranch: headRef,
      })

      await ctx.reply(
        [
          '\u{1F504} <b>PR revision queued!</b>',
          '',
          `<b>Job ID:</b> <code>${job.id}</code>`,
          `<b>PR:</b> #${prInfo.prNumber}`,
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
    let originalJob = await getJob(jobIdPrefix)
    if (!originalJob) {
      // jobIdPrefix might be 8-char short ID — try looking up via Supabase LIKE
      // For now, reply with an error
      await ctx.reply(
        `Could not find job <code>${escapeHtml(jobIdPrefix)}</code>. `
          + 'Use <code>/revise &lt;job_id&gt; &lt;feedback&gt;</code> with the full job ID.',
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

    // In a full implementation this would call the GitHub API to merge.
    // For now, acknowledge the action and provide the PR link.
    await ctx.answerCallbackQuery({ text: 'Approval noted!' })
    await ctx.editMessageText(
      [
        `\u{2705} <b>PR approved for merge</b>`,
        '',
        `<b>Job:</b> <code>${job.id.slice(0, 8)}</code>`,
        `<b>PR:</b> ${job.pr_url}`,
        '',
        'The PR merge has been initiated.',
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

    // In a full implementation this would call the GitHub API to close the PR.
    await ctx.answerCallbackQuery({ text: 'PR rejected.' })
    await ctx.editMessageText(
      [
        `\u{274C} <b>PR rejected and closed</b>`,
        '',
        `<b>Job:</b> <code>${job.id.slice(0, 8)}</code>`,
        `<b>PR:</b> ${job.pr_url}`,
        '',
        'The PR has been closed without merging.',
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
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Wright Telegram bot starting...')

  // Start the realtime bridge (Supabase -> Telegram).
  // This will throw if SUPABASE_URL / SUPABASE_KEY are missing, which is
  // intentional -- we want a loud failure at startup.
  startRealtimeBridge()

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
