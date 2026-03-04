import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectTestRunner, detectPackageManager, detectMonorepo, runTests } from '../test-runner.js'

// Helper: create a temp directory with specific files
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'wright-test-'))
}

function touchFile(dir: string, name: string, content = ''): void {
  const filePath = join(dir, name)
  const parent = filePath.substring(0, filePath.lastIndexOf('/'))
  mkdirSync(parent, { recursive: true })
  writeFileSync(filePath, content)
}

describe('detectTestRunner', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('detects playwright from playwright.config.ts', () => {
    touchFile(tempDir, 'playwright.config.ts')
    expect(detectTestRunner(tempDir)).toBe('playwright')
  })

  it('detects playwright from playwright.config.js', () => {
    touchFile(tempDir, 'playwright.config.js')
    expect(detectTestRunner(tempDir)).toBe('playwright')
  })

  it('detects cargo-test from Cargo.toml', () => {
    touchFile(tempDir, 'Cargo.toml', '[package]\nname = "test"')
    expect(detectTestRunner(tempDir)).toBe('cargo-test')
  })

  it('detects go-test from go.mod', () => {
    touchFile(tempDir, 'go.mod', 'module example.com/test\ngo 1.21')
    expect(detectTestRunner(tempDir)).toBe('go-test')
  })

  it('detects pytest from pyproject.toml', () => {
    touchFile(tempDir, 'pyproject.toml', '[project]\nname = "test"')
    expect(detectTestRunner(tempDir)).toBe('pytest')
  })

  it('detects pytest from setup.py', () => {
    touchFile(tempDir, 'setup.py', 'from setuptools import setup')
    expect(detectTestRunner(tempDir)).toBe('pytest')
  })

  it('detects vitest from package.json devDependencies', () => {
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }),
    )
    expect(detectTestRunner(tempDir)).toBe('vitest')
  })

  it('detects jest from package.json devDependencies', () => {
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      }),
    )
    expect(detectTestRunner(tempDir)).toBe('jest')
  })

  it('detects @playwright/test from package.json dependencies', () => {
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        dependencies: { '@playwright/test': '^1.0.0' },
      }),
    )
    expect(detectTestRunner(tempDir)).toBe('playwright')
  })

  it('defaults to jest for package.json without recognized test deps', () => {
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        dependencies: { express: '^4.0.0' },
      }),
    )
    expect(detectTestRunner(tempDir)).toBe('jest')
  })

  it('returns custom for empty directory', () => {
    expect(detectTestRunner(tempDir)).toBe('custom')
  })

  it('prioritizes playwright config over package.json vitest', () => {
    touchFile(tempDir, 'playwright.config.ts')
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }),
    )
    expect(detectTestRunner(tempDir)).toBe('playwright')
  })

  it('prioritizes Cargo.toml over package.json', () => {
    touchFile(tempDir, 'Cargo.toml', '[package]\nname = "test"')
    touchFile(tempDir, 'package.json', JSON.stringify({}))
    expect(detectTestRunner(tempDir)).toBe('cargo-test')
  })
})

describe('detectPackageManager', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('detects uv from uv.lock', () => {
    touchFile(tempDir, 'uv.lock')
    expect(detectPackageManager(tempDir)).toBe('uv')
  })

  it('detects poetry from poetry.lock', () => {
    touchFile(tempDir, 'poetry.lock')
    expect(detectPackageManager(tempDir)).toBe('poetry')
  })

  it('detects pip from Pipfile.lock', () => {
    touchFile(tempDir, 'Pipfile.lock')
    expect(detectPackageManager(tempDir)).toBe('pip')
  })

  it('detects pip from requirements.txt', () => {
    touchFile(tempDir, 'requirements.txt')
    expect(detectPackageManager(tempDir)).toBe('pip')
  })

  it('detects cargo from Cargo.toml', () => {
    touchFile(tempDir, 'Cargo.toml')
    expect(detectPackageManager(tempDir)).toBe('cargo')
  })

  it('detects go from go.mod', () => {
    touchFile(tempDir, 'go.mod')
    expect(detectPackageManager(tempDir)).toBe('go')
  })

  it('detects pnpm from pnpm-lock.yaml', () => {
    touchFile(tempDir, 'pnpm-lock.yaml')
    expect(detectPackageManager(tempDir)).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', () => {
    touchFile(tempDir, 'yarn.lock')
    expect(detectPackageManager(tempDir)).toBe('yarn')
  })

  it('detects npm from package-lock.json', () => {
    touchFile(tempDir, 'package-lock.json')
    expect(detectPackageManager(tempDir)).toBe('npm')
  })

  it('detects npm from package.json (fallback)', () => {
    touchFile(tempDir, 'package.json', '{}')
    expect(detectPackageManager(tempDir)).toBe('npm')
  })

  it('detects uv from pyproject.toml when no lockfile', () => {
    touchFile(tempDir, 'pyproject.toml')
    expect(detectPackageManager(tempDir)).toBe('uv')
  })

  it('returns none for empty directory', () => {
    expect(detectPackageManager(tempDir)).toBe('none')
  })

  it('prioritizes uv.lock over pyproject.toml', () => {
    touchFile(tempDir, 'uv.lock')
    touchFile(tempDir, 'pyproject.toml')
    expect(detectPackageManager(tempDir)).toBe('uv')
  })

  it('prioritizes pnpm-lock.yaml over package.json', () => {
    touchFile(tempDir, 'pnpm-lock.yaml')
    touchFile(tempDir, 'package.json', '{}')
    expect(detectPackageManager(tempDir)).toBe('pnpm')
  })
})

describe('detectMonorepo', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('detects turborepo from turbo.json', () => {
    touchFile(tempDir, 'turbo.json', '{"pipeline":{}}')
    expect(detectMonorepo(tempDir)).toBe('turborepo')
  })

  it('detects pnpm-workspace from pnpm-workspace.yaml', () => {
    touchFile(tempDir, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"')
    expect(detectMonorepo(tempDir)).toBe('pnpm-workspace')
  })

  it('returns none for a plain repo', () => {
    touchFile(tempDir, 'package.json', '{}')
    expect(detectMonorepo(tempDir)).toBe('none')
  })

  it('returns none for an empty directory', () => {
    expect(detectMonorepo(tempDir)).toBe('none')
  })

  it('prioritizes turborepo when both turbo.json and pnpm-workspace.yaml exist', () => {
    touchFile(tempDir, 'turbo.json', '{"pipeline":{}}')
    touchFile(tempDir, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"')
    expect(detectMonorepo(tempDir)).toBe('turborepo')
  })
})

describe('runTests with real commands', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('handles a passing custom test (exit code 0)', () => {
    // Create a trivial script that exits 0
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'echo "all good"' },
      }),
    )
    const results = runTests(tempDir, 'custom', 'npm', 30)
    expect(results.passed).toBe(1)
    expect(results.failed).toBe(0)
    expect(results.total).toBe(1)
    expect(results.duration).toBeGreaterThan(0)
  })

  it('handles a failing custom test (exit code 1)', () => {
    touchFile(
      tempDir,
      'package.json',
      JSON.stringify({
        scripts: { test: 'echo "FAILURE" && exit 1' },
      }),
    )
    const results = runTests(tempDir, 'custom', 'npm', 30)
    expect(results.passed).toBe(0)
    expect(results.failed).toBe(1)
    expect(results.total).toBe(1)
    expect(results.failures.length).toBe(1)
  })
})
