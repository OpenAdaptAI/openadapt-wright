import Link from 'next/link'

const features = [
  {
    title: 'Submit a Task',
    description:
      'Describe what you need — a bug fix, a new feature, a dependency update. Wright handles the rest.',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    title: 'Iterative Test Loop',
    description:
      'Claude edits code, runs your tests, fixes failures, and repeats until tests pass. No single-shot guessing.',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
        />
      </svg>
    ),
  },
  {
    title: 'Get a Pull Request',
    description:
      'Wright creates a PR with passing tests. Review it, request changes, or merge — just like any other PR.',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    ),
  },
]

const languages = [
  { name: 'Python', runners: 'pytest, playwright', managers: 'uv, pip, poetry' },
  {
    name: 'TypeScript / JavaScript',
    runners: 'vitest, jest, playwright',
    managers: 'pnpm, npm, yarn',
  },
  { name: 'Rust', runners: 'cargo test', managers: 'cargo' },
  { name: 'Go', runners: 'go test', managers: 'go' },
]

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Try Wright on public repos',
    features: [
      '3 tasks per month',
      'Public repos only',
      'Telegram bot access',
      'Basic PR creation',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'For individual developers',
    features: [
      '20 tasks per month',
      'Private repos',
      'Web UI dashboard',
      'Priority queue',
      '$5/task overage',
    ],
    cta: 'Start Free Trial',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$99',
    period: '/month',
    description: 'For engineering teams',
    features: [
      '100 tasks per month',
      'GitHub App install',
      'Team dashboard',
      'Org-wide settings',
      '$3/task overage',
    ],
    cta: 'Contact Us',
    highlighted: false,
  },
]

export default function Home() {
  return (
    <main className="flex flex-col items-center">
      {/* Navigation */}
      <nav className="w-full border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-wright-700">Wright</span>
            <span className="rounded-full bg-wright-100 px-2 py-0.5 text-xs font-medium text-wright-700">
              beta
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#features"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Features
            </a>
            <a
              href="#languages"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Languages
            </a>
            <a
              href="#pricing"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Pricing
            </a>
            <Link
              href="/jobs"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Jobs
            </Link>
            <a
              href="https://github.com/OpenAdaptAI/openadapt-wright"
              className="text-sm text-slate-600 hover:text-slate-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <Link
              href="/new"
              className="rounded-lg bg-wright-600 px-4 py-2 text-sm font-medium text-white hover:bg-wright-700"
            >
              Submit a Task
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-24 text-center">
        <h1 className="text-balance text-5xl font-bold tracking-tight text-slate-900">
          Describe a task.
          <br />
          <span className="text-wright-600">Get a pull request.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Wright clones your repo, edits code with Claude, runs your tests
          iteratively until they pass, and creates a PR. Bug fixes, features,
          dependency updates — all test-driven and automated.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/new"
            className="rounded-lg bg-wright-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-wright-700"
          >
            Submit Your First Task
          </Link>
          <a
            href="https://github.com/OpenAdaptAI/openadapt-wright"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="w-full bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            How Wright Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            The Ralph Loop: an iterative, test-driven development cycle powered
            by Claude.
          </p>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-slate-200 bg-slate-50 p-8"
              >
                <div className="text-wright-600">{feature.icon}</div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {feature.title}
                </h3>
                <p className="mt-2 text-slate-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture diagram */}
      <section className="w-full py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            The Pipeline
          </h2>
          <div className="mt-12 rounded-xl border border-slate-200 bg-white p-8 font-mono text-sm text-slate-700">
            <pre className="overflow-x-auto">
              {`  You describe a task
       |
       v
  Wright claims the job from the queue
       |
       v
  Clone repo --> Create feature branch
       |
       v
  Auto-detect test runner & package manager
       |
       v
  +--------------------------+
  |     Ralph Loop           |
  |                          |
  |  Claude edits code       |
  |       |                  |
  |  Run tests               |
  |       |                  |
  |  Tests pass? --> Done    |
  |       |                  |
  |  Tests fail?             |
  |       |                  |
  |  Claude fixes failures   |
  |       |                  |
  |  (repeat up to N times)  |
  +--------------------------+
       |
       v
  Commit, push, create PR
       |
       v
  You review and merge`}
            </pre>
          </div>
        </div>
      </section>

      {/* Supported Languages */}
      <section id="languages" className="w-full bg-white py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Language Support
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Wright auto-detects your test runner and package manager from repo
            files. No configuration needed.
          </p>
          <div className="mt-12 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-sm font-semibold text-slate-900">
                    Language
                  </th>
                  <th className="px-6 py-3 text-sm font-semibold text-slate-900">
                    Test Runners
                  </th>
                  <th className="px-6 py-3 text-sm font-semibold text-slate-900">
                    Package Managers
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {languages.map((lang) => (
                  <tr key={lang.name}>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {lang.name}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {lang.runners}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {lang.managers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="w-full py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Pricing
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
            Start free. Upgrade when you need private repos and more tasks.
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border p-8 ${
                  tier.highlighted
                    ? 'border-wright-600 bg-wright-50 shadow-lg shadow-wright-100'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {tier.name}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {tier.description}
                </p>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-slate-900">
                    {tier.price}
                  </span>
                  <span className="text-slate-600">{tier.period}</span>
                </div>
                <ul className="mt-6 space-y-3">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-slate-600"
                    >
                      <svg
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-wright-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  className={`mt-8 w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${
                    tier.highlighted
                      ? 'bg-wright-600 text-white hover:bg-wright-700'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open Source CTA */}
      <section className="w-full bg-wright-700 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white">
            Open Source at the Core
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-wright-100">
            Wright is MIT-licensed. Self-host it, contribute to it, or use our
            managed service. The choice is yours.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <a
              href="https://github.com/OpenAdaptAI/openadapt-wright"
              className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-wright-700 shadow-sm hover:bg-wright-50"
              target="_blank"
              rel="noopener noreferrer"
            >
              Star on GitHub
            </a>
            <Link
              href="/new"
              className="rounded-lg border border-wright-300 px-6 py-3 text-base font-semibold text-white hover:bg-wright-600"
            >
              Try It Now
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Wright is part of the{' '}
              <a
                href="https://openadapt.ai"
                className="text-wright-600 hover:text-wright-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenAdapt
              </a>{' '}
              ecosystem.
            </p>
            <div className="flex gap-6">
              <a
                href="https://github.com/OpenAdaptAI/openadapt-wright"
                className="text-sm text-slate-500 hover:text-slate-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href="https://github.com/OpenAdaptAI/openadapt-wright/blob/main/docs/PRODUCTIZATION.md"
                className="text-sm text-slate-500 hover:text-slate-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                Docs
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
