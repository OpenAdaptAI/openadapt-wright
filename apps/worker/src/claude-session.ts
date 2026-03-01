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
  onToken?: (text: string) => void
  onToolUse?: (toolName: string, input: string) => void
}

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
    // Remove CLAUDECODE env var to prevent "nested session" detection when the worker
    // itself is running inside a Claude Code session (e.g. during development).
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.CLAUDECODE
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
