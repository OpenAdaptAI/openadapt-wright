'use server'

import { createServerClient } from './supabase'
import { TABLES, JOB_STATUS, DEFAULT_MAX_LOOPS, DEFAULT_MAX_BUDGET_USD } from '@wright/shared'

export interface SubmitTaskParams {
  repoUrl: string
  task: string
  branch?: string
  maxLoops?: number
  maxBudgetUsd?: number
}

export interface SubmitTaskResult {
  success: boolean
  jobId?: string
  error?: string
}

/**
 * Submit a new task to the Wright job queue.
 *
 * This is a Next.js server action -- it runs on the server and is callable
 * from client components. The Supabase service role key never reaches the
 * browser.
 *
 * NOTE: In the MVP, this uses a placeholder github_token. Once GitHub App
 * OAuth is implemented, the token will be derived from the user's
 * installation.
 */
export async function submitTask(
  params: SubmitTaskParams,
): Promise<SubmitTaskResult> {
  try {
    // Validate inputs
    if (!params.repoUrl || !params.task) {
      return { success: false, error: 'Repository URL and task are required' }
    }

    // Validate URL format
    try {
      const url = new URL(params.repoUrl)
      if (url.hostname !== 'github.com') {
        return {
          success: false,
          error: 'Only GitHub repositories are supported',
        }
      }
    } catch {
      return { success: false, error: 'Invalid repository URL' }
    }

    const supabase = createServerClient()

    // TODO: Replace with GitHub App installation token once OAuth is implemented.
    // For now, the github_token field is required by the schema but will be
    // populated from the user's GitHub App installation in production.
    const githubToken = process.env.GITHUB_TOKEN || 'placeholder'

    const { data, error } = await supabase
      .from(TABLES.JOB_QUEUE)
      .insert({
        repo_url: params.repoUrl,
        task: params.task,
        branch: params.branch || 'main',
        max_loops: params.maxLoops || DEFAULT_MAX_LOOPS,
        max_budget_usd: params.maxBudgetUsd || DEFAULT_MAX_BUDGET_USD,
        status: JOB_STATUS.QUEUED,
        total_cost_usd: 0,
        github_token: githubToken,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to insert job:', error)
      return { success: false, error: `Database error: ${error.message}` }
    }

    return { success: true, jobId: data.id }
  } catch (err) {
    console.error('submitTask error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    }
  }
}
