'use client'

import { useState } from 'react'
import Link from 'next/link'
import { submitTask } from '@/lib/actions'

export default function NewTaskPage() {
  const [repoUrl, setRepoUrl] = useState('')
  const [task, setTask] = useState('')
  const [branch, setBranch] = useState('main')
  const [maxLoops, setMaxLoops] = useState(10)
  const [maxBudget, setMaxBudget] = useState(5.0)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    jobId?: string
    error?: string
  } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)

    try {
      const res = await submitTask({
        repoUrl,
        task,
        branch,
        maxLoops,
        maxBudgetUsd: maxBudget,
      })
      setResult(res)
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen">
      {/* Navigation */}
      <nav className="w-full border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2"
          >
            <span className="text-xl font-bold text-wright-700">Wright</span>
            <span className="rounded-full bg-wright-100 px-2 py-0.5 text-xs font-medium text-wright-700">
              beta
            </span>
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-900">Submit a Task</h1>
        <p className="mt-2 text-slate-600">
          Describe what you need done. Wright will clone the repo, make changes,
          run tests, and create a PR.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Repository URL */}
          <div>
            <label
              htmlFor="repoUrl"
              className="block text-sm font-medium text-slate-700"
            >
              Repository URL
            </label>
            <input
              id="repoUrl"
              type="url"
              required
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-wright-500 focus:outline-none focus:ring-1 focus:ring-wright-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              The GitHub repository to work on. Must be accessible with your
              GitHub credentials.
            </p>
          </div>

          {/* Task Description */}
          <div>
            <label
              htmlFor="task"
              className="block text-sm font-medium text-slate-700"
            >
              Task Description
            </label>
            <textarea
              id="task"
              required
              rows={5}
              placeholder="Fix the bug in auth.ts where login fails for users with special characters in their password. The test in auth.test.ts should be updated to cover this case."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-wright-500 focus:outline-none focus:ring-1 focus:ring-wright-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Be specific. Mention file names, test expectations, and acceptance
              criteria when possible.
            </p>
          </div>

          {/* Branch */}
          <div>
            <label
              htmlFor="branch"
              className="block text-sm font-medium text-slate-700"
            >
              Base Branch
            </label>
            <input
              id="branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-wright-500 focus:outline-none focus:ring-1 focus:ring-wright-500"
            />
          </div>

          {/* Advanced Options */}
          <details className="rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
              Advanced Options
            </summary>
            <div className="space-y-4 border-t border-slate-200 px-4 py-4">
              <div>
                <label
                  htmlFor="maxLoops"
                  className="block text-sm font-medium text-slate-700"
                >
                  Max Loops (edit-test-fix cycles)
                </label>
                <input
                  id="maxLoops"
                  type="number"
                  min={1}
                  max={50}
                  value={maxLoops}
                  onChange={(e) => setMaxLoops(parseInt(e.target.value, 10))}
                  className="mt-1 block w-32 rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:border-wright-500 focus:outline-none focus:ring-1 focus:ring-wright-500"
                />
              </div>
              <div>
                <label
                  htmlFor="maxBudget"
                  className="block text-sm font-medium text-slate-700"
                >
                  Max Budget (USD)
                </label>
                <div className="relative mt-1 w-32">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                    $
                  </span>
                  <input
                    id="maxBudget"
                    type="number"
                    min={0.5}
                    max={100}
                    step={0.5}
                    value={maxBudget}
                    onChange={(e) =>
                      setMaxBudget(parseFloat(e.target.value))
                    }
                    className="block w-full rounded-lg border border-slate-300 py-2 pl-7 pr-4 text-slate-900 focus:border-wright-500 focus:outline-none focus:ring-1 focus:ring-wright-500"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Maximum Claude API spend for this task.
                </p>
              </div>
            </div>
          </details>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || !repoUrl || !task}
            className="w-full rounded-lg bg-wright-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-wright-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Task'}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div
            className={`mt-6 rounded-lg border p-4 ${
              result.success
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            {result.success ? (
              <div>
                <p className="font-medium text-green-800">
                  Task submitted successfully!
                </p>
                <p className="mt-1 text-sm text-green-700">
                  Job ID:{' '}
                  <code className="rounded bg-green-100 px-1 py-0.5 font-mono text-xs">
                    {result.jobId}
                  </code>
                </p>
                <Link
                  href={`/jobs/${result.jobId}`}
                  className="mt-2 inline-block text-sm font-medium text-green-700 underline hover:text-green-800"
                >
                  View job status
                </Link>
              </div>
            ) : (
              <div>
                <p className="font-medium text-red-800">
                  Failed to submit task
                </p>
                <p className="mt-1 text-sm text-red-700">{result.error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
