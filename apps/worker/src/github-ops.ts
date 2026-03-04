import simpleGit from 'simple-git'

export async function cloneRepo(repoUrl: string, workDir: string, token: string, branch?: string): Promise<void> {
  const cleanToken = token.trim()
  const authedUrl = repoUrl.replace('https://', `https://x-access-token:${cleanToken}@`)
  const git = simpleGit()
  try {
    const cloneArgs = branch ? ['--branch', branch] : []
    await git.clone(authedUrl, workDir, cloneArgs)
    // Strip credentials from the stored remote URL so they aren't
    // accessible via .git/config (e.g. by the Claude subprocess).
    const repoGit = simpleGit(workDir)
    await repoGit.remote(['set-url', 'origin', repoUrl])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(sanitizeGitError(msg, cleanToken))
  }
}

function sanitizeGitError(message: string, token: string): string {
  return message
    .replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
    .replace(/x-access-token:[^\s@]+/g, 'x-access-token:***')
}

/**
 * Create a feature branch for the dev loop work.
 */
export async function createFeatureBranch(
  workDir: string,
  branchName: string,
): Promise<string> {
  const git = simpleGit(workDir)
  await git.checkoutLocalBranch(branchName)
  return branchName
}

/**
 * Check out an existing remote branch (e.g. for revision jobs that push to
 * an already-open PR's branch).
 */
export async function checkoutExistingBranch(
  workDir: string,
  branchName: string,
): Promise<string> {
  const git = simpleGit(workDir)
  await git.fetch('origin', branchName)
  await git.checkout(branchName)
  return branchName
}

export async function commitAndPush(workDir: string, message: string, githubToken?: string): Promise<string> {
  const git = simpleGit(workDir)

  await git.addConfig('user.email', 'wright@openadaptai.noreply.github.com')
  await git.addConfig('user.name', 'Wright Bot')

  await git.add('.')

  const status = await git.status()
  if (status.files.length === 0) {
    const log = await git.log({ maxCount: 1 })
    return log.latest?.hash || ''
  }

  await git.commit(message)

  // Re-inject credentials for push (they were stripped from the remote after clone).
  const cleanToken = githubToken?.trim()
  if (cleanToken) {
    const remotes = await git.remote(['-v'])
    const originMatch = (remotes || '').match(/origin\s+(https:\/\/[^\s]+)/)
    if (originMatch) {
      const authedUrl = originMatch[1].replace('https://', `https://x-access-token:${cleanToken}@`)
      await git.remote(['set-url', 'origin', authedUrl])
    }
  }

  const branchStatus = await git.branch()
  const currentBranch = branchStatus.current

  try {
    await git.push('origin', currentBranch)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(cleanToken ? sanitizeGitError(msg, cleanToken) : msg)
  } finally {
    // Strip credentials from remote again after push.
    if (cleanToken) {
      const remotes = await git.remote(['-v'])
      const originMatch = (remotes || '').match(/origin\s+(https:\/\/[^\s@]+@)?([^\s]+)/)
      if (originMatch) {
        const plainUrl = originMatch[0].replace(/x-access-token:[^@]+@/, '')
        await git.remote(['set-url', 'origin', plainUrl.replace(/^origin\s+/, '')]).catch(() => {})
      }
    }
  }

  const log = await git.log({ maxCount: 1 })
  return log.latest?.hash || ''
}

/**
 * Create a pull request using the gh CLI.
 * Requires `githubToken` so the `gh` CLI can authenticate without `gh auth login`.
 */
export async function createPullRequest(
  workDir: string,
  title: string,
  body: string,
  baseBranch: string = 'main',
  githubToken?: string,
): Promise<string> {
  const { execFileSync } = await import('child_process')
  // Minimal env — only what `gh` needs. Avoids leaking SUPABASE_SERVICE_ROLE_KEY etc.
  const env: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/home/wright',
  }
  if (githubToken) {
    env.GH_TOKEN = githubToken
  }
  const result = execFileSync(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch],
    { cwd: workDir, encoding: 'utf-8', env },
  )
  return result.trim() // Returns the PR URL
}
