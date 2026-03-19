import Link from 'next/link'

/**
 * Job detail page -- shows status, events timeline, and test results.
 *
 * This is a scaffold. The full implementation will:
 * - Fetch job details from Supabase
 * - Subscribe to real-time job_events updates
 * - Show test result diffs between loops
 * - Link to the created PR
 */
export default function JobDetailPage({
  params,
}: {
  params: { id: string }
}) {
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
          <Link
            href="/new"
            className="rounded-lg bg-wright-600 px-4 py-2 text-sm font-medium text-white hover:bg-wright-700"
          >
            New Task
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Job Details</h1>
          <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-600">
            {params.id}
          </code>
        </div>

        {/* Placeholder for job details */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8">
          <div className="space-y-4 text-slate-600">
            <p>
              This page will show real-time job status, event timeline, and test
              results once connected to Supabase.
            </p>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-700">
                Coming Soon
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                <li>Real-time status updates via Supabase Realtime</li>
                <li>Event timeline (claimed, cloning, editing, testing...)</li>
                <li>Test results per loop iteration</li>
                <li>Cost tracking (API spend per loop)</li>
                <li>Link to created PR</li>
                <li>Cancel / retry controls</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
