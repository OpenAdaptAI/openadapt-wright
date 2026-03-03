/**
 * Wright Dev Loop — generalized Ralph Loop for any repo.
 *
 * 1. Clone repo, create feature branch
 * 2. Auto-detect test runner and package manager
 * 3. Install dependencies
 * 4. Loop: Claude session → run tests → feed failures back
 * 5. Commit, push, create PR
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DevLoopConfig, DevLoopResult, TestResults, TestFailure } from '@wright/shared'
import { MIN_BUDGET_PER_LOOP_USD, DEFAULT_MAX_TURNS_PER_LOOP } from '@wright/shared'
import { cloneRepo, createFeatureBranch, checkoutExistingBranch, commitAndPush, createPullRequest } from './github-ops.js'
import { detectTestRunner, detectPackageManager, installDependencies, runTests } from './test-runner.js'
import { runClaudeSession } from './claude-session.js'
import { existsSync, rmSync, mkdirSync } from 'fs'

/**
 * Strip Telegram HTML-like formatting delimiters (e.g. `<b>`, `</b>`, `<code>`) from
 * raw message text so they don't leak into prompts, PR bodies, or commit messages.
 */
function sanitizeTaskText(text: string): string {
  return text.replace(/<\/?[^>]+>/g, '').trim()
}

export async function runDevLoop(config: DevLoopConfig): Promise<DevLoopResult> {
  const { job } = config
  // Sanitize task text early so all downstream uses (prompts, PR body, commit messages)
  // receive clean text without Telegram formatting delimiters.
  job.task = sanitizeTaskText(job.task)

  const maxLoops = job.max_loops
  const maxBudget = job.max_budget_usd
  const maxTurns = config.maxTurnsPerLoop || DEFAULT_MAX_TURNS_PER_LOOP

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
  const baseDir = process.env.WORKSPACE_DIR || '/tmp/wright-work'
  const workDir = `${baseDir}/${job.id}`

  // Ensure clean workdir
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })

  let totalCost = 0
  let loopsCompleted = 0
  let lastTestResults: TestResults = {
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    total: 0,
    duration: 0,
    failures: [],
  }

  try {
    // 1. Clone the repository
    await emit(supabase, job.id, 'cloned', undefined, { message: 'Cloning repository...' })

    // Revision jobs have a feature_branch set — clone main then checkout that branch.
    // New jobs clone the base branch and create a fresh feature branch.
    const isRevision = !!job.feature_branch
    let branchName: string

    if (isRevision) {
      await cloneRepo(job.repo_url, workDir, job.github_token)
      branchName = await checkoutExistingBranch(workDir, job.feature_branch!)
    } else {
      await cloneRepo(job.repo_url, workDir, job.github_token, job.branch)
      branchName = `wright/${job.id.slice(0, 8)}`
      await createFeatureBranch(workDir, branchName)
    }

    // 3. Auto-detect test runner and package manager
    const testRunner = job.test_runner || detectTestRunner(workDir)
    const packageManager = job.package_manager || detectPackageManager(workDir)

    console.log(
      `[dev-loop] Detected: testRunner=${testRunner}, packageManager=${packageManager}`,
    )
    await emit(supabase, job.id, 'cloned', undefined, {
      testRunner,
      packageManager,
      branch: branchName,
    })

    // 4. Install dependencies
    try {
      installDependencies(workDir, packageManager)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit(supabase, job.id, 'error', undefined, {
        message: `Dependency installation failed: ${msg}`,
      })
      throw err
    }

    // 5. Dev Loop
    let allTestsPassed = false
    let sessionId: string | undefined
    let consecutiveIdenticalFailures = 0
    let lastFailureSignature = ''

    for (
      let loop = 1;
      loop <= maxLoops && totalCost < maxBudget && !allTestsPassed;
      loop++
    ) {
      // Check for abort (e.g. SIGTERM)
      if (config.abortController?.signal.aborted) break

      // Minimum budget guard
      const remainingBudget = maxBudget - totalCost
      if (loop > 1 && remainingBudget < MIN_BUDGET_PER_LOOP_USD) {
        await emit(supabase, job.id, 'budget_exceeded', loop, {
          remaining: remainingBudget,
          minimum: MIN_BUDGET_PER_LOOP_USD,
        })
        break
      }

      loopsCompleted = loop
      await emit(supabase, job.id, 'loop_start', loop, {
        message: `Dev loop iteration ${loop}/${maxLoops}`,
      })

      // 5a. Run Claude
      const prompt =
        loop === 1
          ? buildInitialPrompt(job.task, testRunner, packageManager)
          : buildContinuationPrompt(loop, lastTestResults)

      const systemPrompt = buildSystemPrompt(workDir, testRunner, packageManager)

      const CLAUDE_SESSION_TIMEOUT_MS = 20 * 60 * 1000

      let result: { costUsd: number; turns: number; sessionId?: string }
      try {
        result = await Promise.race([
          runClaudeSession({
            prompt,
            systemPrompt,
            workDir,
            model: config.model,
            maxTurns,
            maxBudgetUsd: maxBudget - totalCost,
            anthropicApiKey: config.anthropicApiKey,
            abortController: config.abortController,
            sessionId,
            onToken: (text: string) => {
              // Future: stream to Supabase realtime channel
            },
            onToolUse: (toolName: string, input: string) => {
              emit(supabase, job.id, 'edit', loop, {
                tool: toolName,
                summary: input.slice(0, 200),
              })
            },
          }),
          new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error('Claude session timed out after 20 minutes'),
                ),
              CLAUDE_SESSION_TIMEOUT_MS,
            )
            // Clear timeout if abort fires (prevents dangling timer)
            config.abortController?.signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(new Error('Claude session aborted'))
            }, { once: true })
          }),
        ])
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await emit(supabase, job.id, 'error', loop, {
          message: `Code generation failed: ${errMsg}`,
        })
        throw err
      }

      if (result.turns === 0) {
        throw new Error(
          'Claude session produced 0 turns — check ANTHROPIC_API_KEY',
        )
      }

      totalCost += result.costUsd
      sessionId = result.sessionId

      // 5b. Run tests
      await emit(supabase, job.id, 'test_run', loop, {
        message: 'Running tests...',
      })
      lastTestResults = runTests(
        workDir,
        testRunner,
        packageManager,
        config.testTimeoutSeconds,
      )

      // Store test results
      await supabase.from('test_results').insert({
        job_id: job.id,
        loop_number: loop,
        passed: lastTestResults.passed,
        failed: lastTestResults.failed,
        errors: lastTestResults.errors,
        skipped: lastTestResults.skipped,
        total: lastTestResults.total,
        duration: lastTestResults.duration,
        failures: lastTestResults.failures,
        raw: lastTestResults.raw,
      })

      const eventType =
        lastTestResults.failed === 0 && lastTestResults.errors === 0
          ? 'test_pass'
          : 'test_fail'
      await emit(supabase, job.id, eventType, loop, {
        passed: lastTestResults.passed,
        failed: lastTestResults.failed,
        total: lastTestResults.total,
      })

      // Circuit breaker: repeated identical failures
      const currentSignature = lastTestResults.failures
        .map((f: TestFailure) => f.message.slice(0, 100))
        .sort()
        .join('|')

      if (
        currentSignature === lastFailureSignature &&
        lastTestResults.passed === 0 &&
        lastTestResults.failed > 0
      ) {
        consecutiveIdenticalFailures++
      } else {
        consecutiveIdenticalFailures = 0
      }
      lastFailureSignature = currentSignature

      if (consecutiveIdenticalFailures >= 2) {
        await emit(supabase, job.id, 'error', loop, {
          message: `Same failures repeated ${consecutiveIdenticalFailures + 1} times. Aborting.`,
        })
        break
      }

      // 5c. Check pass
      allTestsPassed =
        lastTestResults.failed === 0 && lastTestResults.errors === 0
    }

    // 6. Commit and push
    // Try to read a Claude-generated PR title from the workdir
    const prTitleFile = `${workDir}/.wright-pr-title`
    let generatedTitle: string | undefined
    try {
      const { readFileSync } = await import('fs')
      generatedTitle = readFileSync(prTitleFile, 'utf-8').trim().slice(0, 70)
      // Clean up the file so it doesn't get committed
      const { unlinkSync } = await import('fs')
      unlinkSync(prTitleFile)
    } catch {
      // No title file — will fall back to task-based title
    }

    const prTitle = generatedTitle || `feat: ${job.task.slice(0, 60)}`
    const commitMessage = allTestsPassed
      ? prTitle
      : `wip: ${job.task.slice(0, 60)} (${lastTestResults.passed}/${lastTestResults.total} tests passing)`

    const commitSha = await commitAndPush(workDir, commitMessage, job.github_token)

    // 7. Create PR (skip for revision jobs — the PR already exists)
    let prUrl: string | undefined
    if (isRevision) {
      // For revisions we just pushed to the existing branch; the PR auto-updates.
      // Look up the existing PR URL from the parent job.
      if (job.parent_job_id) {
        const { data: parentJob } = await supabase
          .from('job_queue')
          .select('pr_url')
          .eq('id', job.parent_job_id)
          .single()
        prUrl = parentJob?.pr_url
      }
      if (prUrl) {
        await emit(supabase, job.id, 'pr_created', undefined, { prUrl, revision: true })
      }
    } else {
      try {
        prUrl = await createPullRequest(
          workDir,
          prTitle,
          buildPrBody(job.task, lastTestResults, loopsCompleted, totalCost),
          job.branch,
          job.github_token,
        )
        await emit(supabase, job.id, 'pr_created', undefined, { prUrl })
      } catch (err) {
        console.error('[dev-loop] Failed to create PR:', err)
      }
    }

    await emit(supabase, job.id, 'completed', undefined, {
      success: allTestsPassed,
      loops: loopsCompleted,
      cost: totalCost,
      prUrl,
    })

    return {
      success: allTestsPassed,
      loopsCompleted,
      totalCostUsd: totalCost,
      finalTestResults: lastTestResults,
      prUrl,
      commitSha,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await emit(supabase, job.id, 'error', undefined, { message: msg })

    return {
      success: false,
      loopsCompleted,
      totalCostUsd: totalCost,
      finalTestResults: lastTestResults,
      error: msg,
    }
  } finally {
    // Cleanup workdir
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

// ---- Prompt builders ----

function buildSystemPrompt(
  workDir: string,
  testRunner: string,
  packageManager: string,
): string {
  return `You are an expert software developer working on an automated dev task.

## Working Directory
${workDir}

## Environment
- Test runner: ${testRunner}
- Package manager: ${packageManager}
- Dependencies are already installed

## Rules
1. Make changes to implement the requested task.
2. After making changes, run tests to verify they pass.
3. If tests fail, fix the code (not the tests) unless the tests are clearly wrong.
4. Keep changes minimal and focused ONLY on the files directly required by the task.
5. Do not refactor unrelated code.
6. Do not add unnecessary dependencies.

## Hard constraints — NEVER violate these
- NEVER modify test files unless the task explicitly asks for test changes.
- NEVER modify package manifests (package.json, pyproject.toml, Cargo.toml, go.mod, setup.py, setup.cfg, etc.) unless the task explicitly requires adding or removing a dependency.
- NEVER modify lock files (uv.lock, pnpm-lock.yaml, package-lock.json, yarn.lock, Cargo.lock, poetry.lock, etc.) under any circumstances.
- If the task is about documentation (README, docs/, *.md), ONLY modify documentation files. Do NOT touch source code, tests, or manifests.
- When in doubt about whether a file is in scope, leave it unchanged.

## PR Title
After completing your changes, write a short conventional-commit-style PR title (e.g. "feat: add ecosystem section to README" or "fix: correct broken link in docs") to the file \`.wright-pr-title\` in the repo root. The title MUST be under 70 characters. Do NOT include a PR body — just the title on a single line.`
}

function buildInitialPrompt(
  task: string,
  testRunner: string,
  packageManager: string,
): string {
  return `## Task
${task}

## Instructions
1. Read the relevant source files to understand the codebase
2. Implement the requested changes
3. Run the test suite to verify nothing is broken
4. If tests fail, fix the code and re-run tests

Test command: Use the appropriate command for ${testRunner} (the test runner is already installed via ${packageManager}).`
}

function buildContinuationPrompt(
  loop: number,
  testResults: TestResults,
): string {
  const passing = testResults.failures.length === 0
    ? `All ${testResults.passed} tests passed.`
    : `${testResults.passed} tests passed.`

  const failing = testResults.failures
    .map((f: TestFailure) => `- ${f.name}: ${f.message}`)
    .join('\n')

  return `Dev loop iteration ${loop}.

## Test Results: ${testResults.total} tests, ${testResults.passed} passed, ${testResults.failed} failed

### Passing
${passing}

### Failing
${failing || '(none)'}

## Instructions
1. Fix the failing tests by modifying the application code
2. Do NOT delete or modify existing tests
3. Run the full test suite after making changes to verify nothing regressed`
}

function buildPrBody(
  task: string,
  testResults: TestResults,
  loops: number,
  cost: number,
): string {
  const status =
    testResults.failed === 0 && testResults.total > 0
      ? 'All tests passing'
      : `${testResults.passed}/${testResults.total} tests passing`

  return `## Summary
Automated dev task completed by Wright.

**Task:** ${task}

## Results
- **Status:** ${status}
- **Dev loops:** ${loops}
- **API cost:** $${cost.toFixed(2)}
- **Tests:** ${testResults.passed} passed, ${testResults.failed} failed, ${testResults.total} total

---
Generated by [Wright](https://github.com/OpenAdaptAI/openadapt-wright)`
}

async function emit(
  supabase: SupabaseClient,
  jobId: string,
  eventType: string,
  loopNumber?: number,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('job_events').insert({
    job_id: jobId,
    event_type: eventType,
    loop_number: loopNumber,
    payload,
  })
  if (error) {
    console.error(
      `[dev-loop] Failed to insert ${eventType} event:`,
      error.message,
    )
  }
}
