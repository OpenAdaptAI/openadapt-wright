import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wright — AI Dev Automation',
  description:
    'Submit a task, get a pull request. Wright uses Claude to edit code, run tests, and create PRs automatically.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
