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
import { cloneRepo, createFeatureBranch, commitAndPush, createPullRequest } from './github-ops.js'
import { detectTestRunner, detectPackageManager, installDependencies, runTests } from './test-runner.js'
import { runClaudeSession } from './claude-session.js'
import { existsSync, rmSync, mkdirSync } from 'fs'

export async function runDevLoop(config: DevLoopConfig): Promise<DevLoopResult> {
  const { job } = config
  const maxLoops = job.max_loops
  const maxBudget = job.max_budget_usd
  const maxTurns = config.maxTurnsPerLoop || DEFAULT_MAX_TURNS_PER_LOOP

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
  const workDir = `/tmp/wright-work/${job.id}`

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
    // 1. Clone
    await emit(supabase, job.id, 'cloned', undefined, { message: 'Cloning repository...' })
    await cloneRepo(job.repo_url, workDir, job.github_token)

    // 2. Create feature branch
    const branchName = `wright/${job.id.slice(0, 8)}`
    await createFeatureBranch(workDir, branchName)

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
    installDependencies(workDir, packageManager)

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
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error('Claude session timed out after 20 minutes'),
                ),
              CLAUDE_SESSION_TIMEOUT_MS,
            ),
          ),
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
        lastTestResults.failed === 0 && lastTestResults.total > 0
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
        lastTestResults.failed === 0 && lastTestResults.total > 0
    }

    // 6. Commit and push
    const commitMessage = allTestsPassed
      ? `feat: ${job.task.slice(0, 60)}`
      : `wip: ${job.task.slice(0, 60)} (${lastTestResults.passed}/${lastTestResults.total} tests passing)`

    const commitSha = await commitAndPush(workDir, commitMessage)

    // 7. Create PR
    let prUrl: string | undefined
    try {
      prUrl = await createPullRequest(
        workDir,
        job.task.slice(0, 70),
        buildPrBody(job.task, lastTestResults, loopsCompleted, totalCost),
        job.branch,
      )
      await emit(supabase, job.id, 'pr_created', undefined, { prUrl })
    } catch (err) {
      console.error('[dev-loop] Failed to create PR:', err)
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
1. Make changes to implement the requested task
2. After making changes, run tests to verify they pass
3. If tests fail, fix the code (not the tests) unless the tests are clearly wrong
4. Keep changes minimal and focused on the task
5. Do not refactor unrelated code
6. Do not add unnecessary dependencies`
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
Generated by [Wright](https://github.com/OpenAdaptAI/wright)`
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
