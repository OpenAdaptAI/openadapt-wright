import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { createFeatureBranch, commitAndPush } from '../github-ops.js'

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wright-git-'))
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  // Create initial commit so HEAD exists
  execSync('touch README.md && git add . && git commit -m "init"', {
    cwd: dir,
    stdio: 'pipe',
  })
  return dir
}

describe('createFeatureBranch', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempGitRepo()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates a new branch and returns the branch name', async () => {
    const branchName = 'wright/test-123'
    const result = await createFeatureBranch(tempDir, branchName)
    expect(result).toBe(branchName)

    // Verify we're on the new branch
    const current = execSync('git branch --show-current', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()
    expect(current).toBe(branchName)
  })

  it('creates branch with slash in name', async () => {
    const branchName = 'wright/abc12345'
    await createFeatureBranch(tempDir, branchName)

    const current = execSync('git branch --show-current', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()
    expect(current).toBe(branchName)
  })
})

describe('commitAndPush (local only, no remote)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempGitRepo()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns latest hash when no changes to commit', async () => {
    const hash = await commitAndPush(tempDir, 'nothing to commit')
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('commits new files and returns new hash', async () => {
    const oldHash = execSync('git rev-parse HEAD', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()

    // Add a new file
    execSync('echo "hello" > newfile.txt', { cwd: tempDir, stdio: 'pipe' })

    // commitAndPush will fail on push (no remote), but commit should work
    // We need to catch the push error
    try {
      await commitAndPush(tempDir, 'add newfile')
    } catch {
      // Expected: push fails because no remote
    }

    const newHash = execSync('git rev-parse HEAD', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()

    // Verify commit was created (hash changed)
    expect(newHash).not.toBe(oldHash)

    // Verify commit message
    const msg = execSync('git log -1 --format=%s', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()
    expect(msg).toBe('add newfile')
  })
})
