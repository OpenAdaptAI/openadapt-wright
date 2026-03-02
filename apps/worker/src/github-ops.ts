import simpleGit from 'simple-git'

export async function cloneRepo(repoUrl: string, workDir: string, token: string): Promise<void> {
  const cleanToken = token.trim()
  const authedUrl = repoUrl.replace('https://', `https://x-access-token:${cleanToken}@`)
  const git = simpleGit()
  try {
    await git.clone(authedUrl, workDir)
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

export async function commitAndPush(workDir: string, message: string): Promise<string> {
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

  const branchStatus = await git.branch()
  const currentBranch = branchStatus.current
  await git.push('origin', currentBranch)

  const log = await git.log({ maxCount: 1 })
  return log.latest?.hash || ''
}

/**
 * Create a pull request using the gh CLI.
 */
export async function createPullRequest(
  workDir: string,
  title: string,
  body: string,
  baseBranch: string = 'main',
): Promise<string> {
  const { execFileSync } = await import('child_process')
  const result = execFileSync(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch],
    { cwd: workDir, encoding: 'utf-8' },
  )
  return result.trim() // Returns the PR URL
}
