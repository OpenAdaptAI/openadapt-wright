import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { TestRunner, PackageManager, TestResults, TestFailure } from '@wright/shared'

/**
 * Auto-detect the test runner from repo files.
 */
export function detectTestRunner(workDir: string): TestRunner {
  // Check for Playwright config
  if (
    existsSync(join(workDir, 'playwright.config.ts')) ||
    existsSync(join(workDir, 'playwright.config.js'))
  ) {
    return 'playwright'
  }

  // Check Cargo.toml (Rust)
  if (existsSync(join(workDir, 'Cargo.toml'))) {
    return 'cargo-test'
  }

  // Check go.mod (Go)
  if (existsSync(join(workDir, 'go.mod'))) {
    return 'go-test'
  }

  // Check for Python test runners
  const pyprojectPath = join(workDir, 'pyproject.toml')
  if (existsSync(pyprojectPath)) {
    return 'pytest'
  }
  if (existsSync(join(workDir, 'setup.py')) || existsSync(join(workDir, 'setup.cfg'))) {
    return 'pytest'
  }

  // Check package.json for JS test runners
  const pkgPath = join(workDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      }
      if (allDeps.vitest) return 'vitest'
      if (allDeps.jest) return 'jest'
      if (allDeps['@playwright/test']) return 'playwright'
    } catch {
      // Fall through
    }
    return 'jest' // default for JS projects
  }

  return 'custom'
}

/**
 * Auto-detect the package manager from repo lockfiles.
 */
export function detectPackageManager(workDir: string): PackageManager {
  if (existsSync(join(workDir, 'uv.lock'))) return 'uv'
  if (existsSync(join(workDir, 'poetry.lock'))) return 'poetry'
  if (existsSync(join(workDir, 'Pipfile.lock'))) return 'pip'
  if (existsSync(join(workDir, 'requirements.txt'))) return 'pip'
  if (existsSync(join(workDir, 'Cargo.toml'))) return 'cargo'
  if (existsSync(join(workDir, 'go.mod'))) return 'go'
  if (existsSync(join(workDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(workDir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(workDir, 'package-lock.json'))) return 'npm'
  if (existsSync(join(workDir, 'package.json'))) return 'npm'
  if (existsSync(join(workDir, 'pyproject.toml'))) return 'uv'
  return 'none'
}

/**
 * Install dependencies using the detected package manager.
 */
export function installDependencies(workDir: string, pm: PackageManager): void {
  const commands: Record<PackageManager, string | null> = {
    npm: 'npm install',
    pnpm: 'pnpm install',
    yarn: 'yarn install',
    pip: 'pip install -e .',
    uv: 'uv sync',
    poetry: 'poetry install',
    cargo: 'cargo build',
    go: 'go mod download',
    none: null,
  }

  const cmd = commands[pm]
  if (!cmd) return

  console.log(`[test-runner] Installing dependencies with ${pm}: ${cmd}`)
  try {
    execSync(cmd, { cwd: workDir, stdio: 'pipe', timeout: 300_000 })
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr: unknown }).stderr).slice(-2000)
      : ''
    console.error(`[test-runner] Dependency install failed (${pm}):`, stderr)
    throw new Error(`Failed to install dependencies with ${pm}: ${stderr || 'unknown error'}`)
  }
}

/**
 * Build the test command for the given runner.
 */
function getTestCommand(runner: TestRunner, pm: PackageManager): string {
  switch (runner) {
    case 'pytest':
      return pm === 'uv' ? 'uv run pytest --tb=short -q' : 'pytest --tb=short -q'
    case 'playwright':
      return 'npx playwright test'
    case 'jest':
      return 'npx jest --forceExit'
    case 'vitest':
      return 'npx vitest run'
    case 'go-test':
      return 'go test ./...'
    case 'cargo-test':
      return 'cargo test'
    case 'custom':
      return 'npm test'
  }
}

/**
 * Run the test suite and return structured results.
 */
export function runTests(
  workDir: string,
  runner: TestRunner,
  pm: PackageManager,
  timeoutSeconds: number,
): TestResults {
  const command = getTestCommand(runner, pm)
  const startTime = Date.now()

  console.log(`[test-runner] Running: ${command}`)

  let stdout = ''
  let exitCode = 0

  try {
    stdout = execSync(command, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: timeoutSeconds * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      stdout = (err as { stdout: string }).stdout || ''
    }
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderr = (err as { stderr: string }).stderr || ''
      stdout += '\n' + stderr
    }
    if (err && typeof err === 'object' && 'status' in err) {
      exitCode = (err as { status: number }).status || 1
    } else {
      exitCode = 1
    }
  }

  const duration = (Date.now() - startTime) / 1000
  const raw = stdout.slice(-5000) // Keep last 5KB

  // Parse results based on runner
  const results = parseTestOutput(runner, stdout, exitCode)
  results.duration = duration
  results.raw = raw

  return results
}

/**
 * Strip ANSI escape codes from test output for reliable parsing.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

/**
 * Parse test runner output into structured results.
 */
function parseTestOutput(runner: TestRunner, output: string, exitCode: number): TestResults {
  output = stripAnsi(output)
  const base: TestResults = {
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    total: 0,
    duration: 0,
    failures: [],
  }

  if (exitCode === 0 && !output.trim()) {
    // No tests found or all passed silently
    return base
  }

  switch (runner) {
    case 'pytest':
      return parsePytest(output, exitCode, base)
    case 'jest':
    case 'vitest':
      return parseJest(output, exitCode, base)
    case 'playwright':
      return parsePlaywright(output, exitCode, base)
    case 'go-test':
      return parseGoTest(output, exitCode, base)
    case 'cargo-test':
      return parseCargoTest(output, exitCode, base)
    default:
      return parseGeneric(output, exitCode, base)
  }
}

function parsePytest(output: string, exitCode: number, base: TestResults): TestResults {
  // pytest summary line: "5 passed, 2 failed, 1 error in 3.45s"
  const summaryMatch = output.match(
    /=+ (?:(?:(\d+) passed)?[, ]*(?:(\d+) failed)?[, ]*(?:(\d+) error)?[, ]*(?:(\d+) skipped)?[, ]*)?.*? in [\d.]+s =+/,
  )
  if (summaryMatch) {
    base.passed = parseInt(summaryMatch[1] || '0')
    base.failed = parseInt(summaryMatch[2] || '0')
    base.errors = parseInt(summaryMatch[3] || '0')
    base.skipped = parseInt(summaryMatch[4] || '0')
  }
  base.total = base.passed + base.failed + base.errors + base.skipped

  // Extract FAILED test names and messages
  const failPattern = /FAILED (.+?) - (.+)/g
  let match
  while ((match = failPattern.exec(output)) !== null) {
    base.failures.push({ name: match[1], message: match[2] })
  }

  return base
}

function parseJest(output: string, exitCode: number, base: TestResults): TestResults {
  // Jest summary: "Tests: 2 failed, 5 passed, 7 total"
  const jestMatch = output.match(/Tests:\s+(?:(\d+) failed,?\s*)?(?:(\d+) passed,?\s*)?(\d+) total/)
  if (jestMatch) {
    base.failed = parseInt(jestMatch[1] || '0')
    base.passed = parseInt(jestMatch[2] || '0')
    base.total = parseInt(jestMatch[3] || '0')
  }

  // Vitest summary: "Tests  2 passed (2)" or "Tests  1 failed | 2 passed (3)"
  if (!jestMatch) {
    const vitestMatch = output.match(/Tests\s+(?:(\d+) failed\s*\|?\s*)?(?:(\d+) passed\s*)?\((\d+)\)/)
    if (vitestMatch) {
      base.failed = parseInt(vitestMatch[1] || '0')
      base.passed = parseInt(vitestMatch[2] || '0')
      base.total = parseInt(vitestMatch[3] || '0')
    }
  }

  // Extract failing test names
  const failPattern = /✕|✗|FAIL\s+(.+)/g
  let match
  while ((match = failPattern.exec(output)) !== null) {
    if (match[1]) {
      base.failures.push({ name: match[1].trim(), message: '' })
    }
  }

  return base
}

function parsePlaywright(output: string, exitCode: number, base: TestResults): TestResults {
  // Playwright summary: "5 passed (3.2s)" or "2 failed 5 passed (3.2s)"
  const summaryMatch = output.match(
    /(\d+) failed.*?(\d+) passed|(\d+) passed/,
  )
  if (summaryMatch) {
    if (summaryMatch[1]) {
      base.failed = parseInt(summaryMatch[1])
      base.passed = parseInt(summaryMatch[2] || '0')
    } else {
      base.passed = parseInt(summaryMatch[3] || '0')
    }
  }
  base.total = base.passed + base.failed

  // Extract failing test names
  const failPattern = /\d+\) \[.+?\] › (.+)/g
  let match
  while ((match = failPattern.exec(output)) !== null) {
    base.failures.push({ name: match[1], message: '' })
  }

  return base
}

function parseGoTest(output: string, exitCode: number, base: TestResults): TestResults {
  const passMatch = output.match(/ok\s+/g)
  const failMatch = output.match(/FAIL\s+/g)
  base.passed = passMatch ? passMatch.length : 0
  base.failed = failMatch ? failMatch.length : 0
  if (exitCode === 0 && base.failed === 0) {
    base.passed = Math.max(base.passed, 1)
  }
  base.total = base.passed + base.failed

  const failPattern = /--- FAIL: (\S+)/g
  let match
  while ((match = failPattern.exec(output)) !== null) {
    base.failures.push({ name: match[1], message: '' })
  }

  return base
}

function parseCargoTest(output: string, exitCode: number, base: TestResults): TestResults {
  // cargo test: "test result: ok. 5 passed; 0 failed; 0 ignored"
  const resultMatch = output.match(
    /test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/,
  )
  if (resultMatch) {
    base.passed = parseInt(resultMatch[1])
    base.failed = parseInt(resultMatch[2])
    base.skipped = parseInt(resultMatch[3])
  }
  base.total = base.passed + base.failed + base.skipped

  const failPattern = /---- (\S+) stdout ----/g
  let match
  while ((match = failPattern.exec(output)) !== null) {
    base.failures.push({ name: match[1], message: '' })
  }

  return base
}

function parseGeneric(output: string, exitCode: number, base: TestResults): TestResults {
  if (exitCode === 0) {
    base.passed = 1
    base.total = 1
  } else {
    base.failed = 1
    base.total = 1
    base.failures.push({
      name: 'test suite',
      message: output.slice(-500),
    })
  }
  return base
}
