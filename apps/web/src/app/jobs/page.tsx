'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase'
import { TABLES } from '@wright/shared'
import type { Job } from '@wright/shared'

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

/** Extract short repo name from GitHub URL. */
function repoName(url: string): string {
  return url
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

/** Truncate text with ellipsis. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

export default function JobsListPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchJobs() {
      try {
        const supabase = createBrowserClient()

        const { data, error: fetchError } = await supabase
          .from(TABLES.JOB_QUEUE)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)

        if (fetchError) {
          setError(fetchError.message)
          setLoading(false)
          return
        }

        setJobs((data || []) as Job[])
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch jobs')
        setLoading(false)
      }
    }

    fetchJobs()
  }, [])

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
              className="text-sm font-medium text-wright-600"
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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Recent Jobs</h1>
          <Link
            href="/new"
            className="rounded-lg bg-wright-600 px-4 py-2 text-sm font-medium text-white hover:bg-wright-700"
          >
            Submit a Task
          </Link>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-wright-600" />
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && jobs.length === 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
            <p className="text-slate-500">No jobs yet.</p>
            <Link
              href="/new"
              className="mt-3 inline-block text-sm font-medium text-wright-600 hover:text-wright-700"
            >
              Submit your first task
            </Link>
          </div>
        )}

        {/* Jobs table */}
        {!loading && !error && jobs.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Repository
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Task
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Created
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      {statusBadge(job.status)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="truncate font-mono text-sm text-slate-700">
                        {repoName(job.repo_url)}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="text-sm text-slate-600">
                        {truncate(job.task, 60)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      ${job.total_cost_usd.toFixed(2)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3 text-sm text-slate-400"
                      title={new Date(job.created_at).toLocaleString()}
                    >
                      {timeAgo(job.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-sm font-medium text-wright-600 hover:text-wright-700"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
