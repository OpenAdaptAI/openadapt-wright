'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase'
import { TABLES, JOB_STATUS } from '@wright/shared'
import type { Job, JobEvent } from '@wright/shared'

/** Polling interval for in-progress jobs (ms). */
const POLL_INTERVAL = 5_000

/** Whether a job is still in progress and should be polled. */
function isInProgress(status: string): boolean {
  return (
    status === JOB_STATUS.QUEUED ||
    status === JOB_STATUS.CLAIMED ||
    status === JOB_STATUS.RUNNING
  )
}

/** Human-readable relative time string. */
function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  )
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Status badge color map. */
function statusBadge(status: string) {
  const styles: Record<string, string> = {
    queued: 'bg-slate-100 text-slate-700',
    claimed: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    succeeded: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] || 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  )
}

/** Icon for event timeline entries. */
function eventIcon(eventType: string) {
  const iconMap: Record<string, { bg: string; icon: string }> = {
    claimed: { bg: 'bg-yellow-500', icon: 'C' },
    cloned: { bg: 'bg-blue-500', icon: 'G' },
    loop_start: { bg: 'bg-wright-500', icon: 'L' },
    edit: { bg: 'bg-purple-500', icon: 'E' },
    test_run: { bg: 'bg-slate-500', icon: 'T' },
    test_pass: { bg: 'bg-green-500', icon: 'P' },
    test_fail: { bg: 'bg-red-500', icon: 'F' },
    pr_created: { bg: 'bg-wright-600', icon: 'R' },
    completed: { bg: 'bg-green-600', icon: 'D' },
    error: { bg: 'bg-red-600', icon: '!' },
    budget_exceeded: { bg: 'bg-orange-500', icon: '$' },
  }
  const entry = iconMap[eventType] || { bg: 'bg-slate-400', icon: '?' }
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${entry.bg}`}
    >
      {entry.icon}
    </div>
  )
}

/** Human-readable event type labels. */
function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    claimed: 'Job claimed by worker',
    cloned: 'Repository cloned',
    loop_start: 'Loop iteration started',
    edit: 'Code edited',
    test_run: 'Tests running',
    test_pass: 'Tests passed',
    test_fail: 'Tests failed',
    pr_created: 'Pull request created',
    completed: 'Job completed',
    error: 'Error occurred',
    budget_exceeded: 'Budget limit reached',
  }
  return labels[eventType] || eventType
}

export default function JobDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchJob = useCallback(async () => {
    try {
      const supabase = createBrowserClient()

      const { data: jobData, error: jobError } = await supabase
        .from(TABLES.JOB_QUEUE)
        .select('*')
        .eq('id', params.id)
        .single()

      if (jobError) {
        if (jobError.code === 'PGRST116') {
          setError('Job not found')
        } else {
          setError(jobError.message)
        }
        setLoading(false)
        return
      }

      setJob(jobData as Job)

      const { data: eventsData } = await supabase
        .from(TABLES.JOB_EVENTS)
        .select('*')
        .eq('job_id', params.id)
        .order('created_at', { ascending: true })

      if (eventsData) {
        setEvents(eventsData as JobEvent[])
      }

      setError(null)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch job')
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    fetchJob()
  }, [fetchJob])

  // Poll while job is in progress
  useEffect(() => {
    if (!job || !isInProgress(job.status)) return

    const interval = setInterval(fetchJob, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [job, fetchJob])

  // Extract repo name from URL
  const repoName = job?.repo_url
    ? job.repo_url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    : ''

  return (
    <main className="min-h-screen">
      {/* Navigation */}
      <nav className="w-full border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-wright-700">Wright</span>
            <span className="rounded-full bg-wright-100 px-2 py-0.5 text-xs font-medium text-wright-700">
              beta
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/jobs"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Jobs
            </Link>
            <Link
              href="/new"
              className="rounded-lg bg-wright-600 px-4 py-2 text-sm font-medium text-white hover:bg-wright-700"
            >
              New Task
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-wright-600" />
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-lg font-semibold text-red-800">{error}</h2>
            <p className="mt-2 text-sm text-red-600">
              The job could not be found. It may have been deleted or the ID is
              invalid.
            </p>
            <Link
              href="/jobs"
              className="mt-4 inline-block text-sm font-medium text-red-700 underline hover:text-red-800"
            >
              Back to Jobs
            </Link>
          </div>
        )}

        {/* Job details */}
        {job && !loading && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-slate-900">
                    Job Details
                  </h1>
                  {statusBadge(job.status)}
                  {isInProgress(job.status) && (
                    <span className="text-xs text-slate-400">
                      auto-refreshing
                    </span>
                  )}
                </div>
                <code className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
                  {job.id}
                </code>
              </div>
              {job.pr_url && (
                <a
                  href={job.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-wright-600 px-4 py-2 text-sm font-medium text-white hover:bg-wright-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                  View PR
                </a>
              )}
            </div>

            {/* Info grid */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Repository */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Repository
                </p>
                <a
                  href={job.repo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-sm font-medium text-wright-600 hover:text-wright-700"
                >
                  {repoName}
                </a>
              </div>

              {/* Branch */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Branch
                </p>
                <p className="mt-1 truncate font-mono text-sm text-slate-900">
                  {job.branch}
                </p>
              </div>

              {/* Cost */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Cost
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  ${job.total_cost_usd.toFixed(2)}{' '}
                  <span className="font-normal text-slate-400">
                    / ${job.max_budget_usd.toFixed(2)}
                  </span>
                </p>
              </div>

              {/* Created */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Created
                </p>
                <p
                  className="mt-1 text-sm text-slate-900"
                  title={new Date(job.created_at).toLocaleString()}
                >
                  {timeAgo(job.created_at)}
                </p>
              </div>
            </div>

            {/* Task description */}
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-slate-700">
                Task Description
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                {job.task}
              </p>
            </div>

            {/* Error message */}
            {job.error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6">
                <h2 className="text-sm font-semibold text-red-800">Error</h2>
                <p className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-700">
                  {job.error}
                </p>
              </div>
            )}

            {/* Metadata row */}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
              {job.test_runner && (
                <span>
                  Test runner:{' '}
                  <span className="font-medium text-slate-600">
                    {job.test_runner}
                  </span>
                </span>
              )}
              {job.package_manager && (
                <span>
                  Package manager:{' '}
                  <span className="font-medium text-slate-600">
                    {job.package_manager}
                  </span>
                </span>
              )}
              <span>
                Loops:{' '}
                <span className="font-medium text-slate-600">
                  max {job.max_loops}
                </span>
              </span>
              <span>
                Attempt:{' '}
                <span className="font-medium text-slate-600">
                  {job.attempt} / {job.max_attempts}
                </span>
              </span>
              {job.worker_id && (
                <span>
                  Worker:{' '}
                  <span className="font-mono font-medium text-slate-600">
                    {job.worker_id.slice(0, 8)}
                  </span>
                </span>
              )}
            </div>

            {/* Events timeline */}
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">
                Event Timeline
              </h2>

              {events.length === 0 ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  {isInProgress(job.status)
                    ? 'Waiting for events...'
                    : 'No events recorded for this job.'}
                </div>
              ) : (
                <div className="mt-4 space-y-0">
                  {events.map((event, idx) => (
                    <div key={event.id} className="flex gap-4">
                      {/* Timeline line + icon */}
                      <div className="flex flex-col items-center">
                        {eventIcon(event.event_type)}
                        {idx < events.length - 1 && (
                          <div className="w-0.5 flex-1 bg-slate-200" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 pb-6">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-slate-900">
                            {eventLabel(event.event_type)}
                          </span>
                          {event.loop_number != null && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                              Loop {event.loop_number}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {timeAgo(event.created_at)}
                          </span>
                        </div>

                        {/* Event payload */}
                        {event.payload &&
                          Object.keys(event.payload).length > 0 && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                                details
                              </summary>
                              <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-600">
                                {JSON.stringify(event.payload, null, 2)}
                              </pre>
                            </details>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
