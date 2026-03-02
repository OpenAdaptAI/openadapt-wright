import { query } from '@anthropic-ai/claude-agent-sdk'

export interface ClaudeSessionConfig {
  prompt: string
  systemPrompt: string
  workDir: string
  model: string
  maxTurns: number
  maxBudgetUsd: number
  anthropicApiKey?: string
  sessionId?: string
  abortController?: AbortController
  onToken?: (text: string) => void
  onToolUse?: (toolName: string, input: string) => void
}

const ALLOWED_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'TMPDIR', 'TMP', 'TEMP',
  'NODE_ENV', 'WORKSPACE_DIR',
  'ANTHROPIC_API_KEY',
]

export interface ClaudeSessionResult {
  costUsd: number
  turns: number
  sessionId?: string
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  try {
    switch (toolName) {
      case 'Write':
        return input.file_path ? `Writing ${input.file_path}` : ''
      case 'Edit':
        return input.file_path ? `Editing ${input.file_path}` : ''
      case 'Read':
        return input.file_path ? `Reading ${input.file_path}` : ''
      case 'Bash':
      case 'Execute':
        return input.command ? `$ ${input.command}`.slice(0, 200) : ''
      case 'Glob':
        return input.pattern ? `Finding ${input.pattern}` : ''
      case 'Grep':
        return input.pattern ? `Searching for "${input.pattern}"` : ''
      default:
        return JSON.stringify(input).slice(0, 150)
    }
  } catch {
    return ''
  }
}

export async function runClaudeSession(config: ClaudeSessionConfig): Promise<ClaudeSessionResult> {
  let costUsd = 0
  let turns = 0
  let sessionId = config.sessionId

  try {
    // Build a minimal env to avoid leaking secrets (SUPABASE_SERVICE_ROLE_KEY,
    // BOT_TOKEN, etc.) into the Claude subprocess.
    const env: Record<string, string> = {}
    for (const key of ALLOWED_ENV_KEYS) {
      if (process.env[key]) env[key] = process.env[key]!
    }
    if (config.anthropicApiKey) {
      env.ANTHROPIC_API_KEY = config.anthropicApiKey
    }

    const result = query({
      prompt: config.prompt,
      options: {
        cwd: config.workDir,
        systemPrompt: config.systemPrompt,
        model: config.model,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        env,
        abortController: config.abortController,
        stderr: (data: string) => {
          if (data.trim()) {
            console.error('[claude-code stderr]', data.trim())
          }
        },
      },
    })

    for await (const message of result) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id
      }

      if (message.type === 'assistant') {
        const textBlocks = message.message.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { type: string; text: string }) => b.text)

        if (textBlocks.length > 0 && config.onToken) {
          config.onToken(textBlocks.join('\n'))
        }

        const toolBlocks = message.message.content.filter(
          (b: { type: string }) => b.type === 'tool_use',
        )
        for (const tool of toolBlocks) {
          if (config.onToolUse) {
            config.onToolUse(tool.name, summarizeToolInput(tool.name, tool.input))
          }
        }
      }

      if (message.type === 'result') {
        costUsd = message.total_cost_usd || 0
        turns = message.num_turns || 0
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`Claude session failed: ${msg}`)
  }

  return { costUsd, turns, sessionId }
}
