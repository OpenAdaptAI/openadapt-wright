import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { detectTestRunner, detectPackageManager, detectMonorepo, runTests, stripLocalUvSources, stripHeavyPyDeps } from '../test-runner.js'

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

describe('stripLocalUvSources', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('strips path-based source entries from pyproject.toml', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = [
    "openadapt-ml>=0.11.0",
    "openadapt-consilium>=0.3.2",
]

[tool.uv.sources]
openadapt-consilium = { git = "https://github.com/OpenAdaptAI/openadapt-consilium.git" }
openadapt-ml = { path = "../openadapt-ml", editable = true }

[tool.hatch.build.targets.wheel]
packages = ["my_package"]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)
    touchFile(tempDir, 'uv.lock', 'some lock content')

    stripLocalUvSources(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    // Path-based source override should be removed
    expect(result).not.toContain('path = "../openadapt-ml"')
    // But the dependency itself in [project.dependencies] should remain
    expect(result).toContain('openadapt-ml>=0.11.0')
    // Git-based entry should be preserved
    expect(result).toContain('openadapt-consilium')
    expect(result).toContain('git = "https://github.com/')
    // Other sections should be preserved
    expect(result).toContain('[project]')
    expect(result).toContain('[tool.hatch.build.targets.wheel]')
    // uv.lock should be deleted
    expect(existsSync(join(tempDir, 'uv.lock'))).toBe(false)
  })

  it('preserves pyproject.toml without [tool.uv.sources]', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = ["requests>=2.28.0"]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)
    touchFile(tempDir, 'uv.lock', 'some lock content')

    stripLocalUvSources(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    expect(result).toBe(pyprojectContent)
    // uv.lock should NOT be deleted when no changes were made
    expect(existsSync(join(tempDir, 'uv.lock'))).toBe(true)
  })

  it('preserves pyproject.toml with only git sources', () => {
    const pyprojectContent = `[project]
name = "test-project"

[tool.uv.sources]
consilium = { git = "https://github.com/example/consilium.git" }
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)
    touchFile(tempDir, 'uv.lock', 'some lock content')

    stripLocalUvSources(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    expect(result).toBe(pyprojectContent)
    // uv.lock should NOT be deleted when no path sources were stripped
    expect(existsSync(join(tempDir, 'uv.lock'))).toBe(true)
  })

  it('handles multiple path-based sources', () => {
    const pyprojectContent = `[project]
name = "test-project"

[tool.uv.sources]
pkg-a = { path = "../pkg-a", editable = true }
pkg-b = { git = "https://github.com/example/pkg-b.git" }
pkg-c = { path = "/absolute/path/to/pkg-c" }
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)

    stripLocalUvSources(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    expect(result).not.toContain('pkg-a')
    expect(result).not.toContain('pkg-c')
    expect(result).toContain('pkg-b')
    expect(result).toContain('git = "https://github.com/')
  })

  it('does nothing when pyproject.toml does not exist', () => {
    // Should not throw
    expect(() => stripLocalUvSources(tempDir)).not.toThrow()
  })
})

describe('stripHeavyPyDeps', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('strips heavy packages from base dependencies', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = [
    "requests>=2.28.0",
    "torch>=2.8.0",
    "torchvision>=0.24.1",
    "pillow>=10.0.0",
    "open-clip-torch>=2.20.0",
    "transformers>=4.57.3",
    "bitsandbytes>=0.41.0",
    "peft>=0.18.0",
]

[tool.hatch.build.targets.wheel]
packages = ["my_package"]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)
    touchFile(tempDir, 'uv.lock', 'some lock content')

    stripHeavyPyDeps(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    // Heavy packages should be removed
    expect(result).not.toContain('torch>=2.8.0')
    expect(result).not.toContain('torchvision')
    expect(result).not.toContain('open-clip-torch')
    expect(result).not.toContain('transformers')
    expect(result).not.toContain('bitsandbytes')
    expect(result).not.toContain('peft')
    // Lightweight packages should be preserved
    expect(result).toContain('requests>=2.28.0')
    expect(result).toContain('pillow>=10.0.0')
    // Other sections should be preserved
    expect(result).toContain('[project]')
    expect(result).toContain('[tool.hatch.build.targets.wheel]')
    // uv.lock should be deleted
    expect(existsSync(join(tempDir, 'uv.lock'))).toBe(false)
  })

  it('strips entire [project.optional-dependencies] section', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = [
    "requests>=2.28.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
]
training = [
    "torch>=2.8.0",
    "trl>=0.12.0",
]
azure = [
    "azure-ai-ml>=1.12.0",
]

[tool.hatch.build.targets.wheel]
packages = ["my_package"]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)

    stripHeavyPyDeps(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    // Entire optional-dependencies section should be removed
    expect(result).not.toContain('[project.optional-dependencies]')
    expect(result).not.toContain('pytest>=8.0.0')
    expect(result).not.toContain('trl>=0.12.0')
    expect(result).not.toContain('azure-ai-ml')
    // Base deps and other sections should be preserved
    expect(result).toContain('requests>=2.28.0')
    expect(result).toContain('[tool.hatch.build.targets.wheel]')
  })

  it('handles nvidia-* prefix packages', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = [
    "requests>=2.28.0",
    "nvidia-cublas-cu12>=12.1.0",
    "nvidia-cuda-runtime-cu12>=12.0",
]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)

    stripHeavyPyDeps(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    expect(result).not.toContain('nvidia-cublas')
    expect(result).not.toContain('nvidia-cuda-runtime')
    expect(result).toContain('requests>=2.28.0')
  })

  it('preserves pyproject.toml with no heavy deps', () => {
    const pyprojectContent = `[project]
name = "test-project"
dependencies = [
    "requests>=2.28.0",
    "pillow>=10.0.0",
]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)
    touchFile(tempDir, 'uv.lock', 'some lock content')

    stripHeavyPyDeps(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    expect(result).toBe(pyprojectContent)
    // uv.lock should NOT be deleted when no changes were made
    expect(existsSync(join(tempDir, 'uv.lock'))).toBe(true)
  })

  it('handles openadapt-evals-like pyproject.toml', () => {
    const pyprojectContent = `[project]
name = "openadapt-evals"
version = "0.46.0"
dependencies = [
    "open-clip-torch>=2.20.0",
    "pillow>=10.0.0",
    "pydantic-settings>=2.0.0",
    "requests>=2.28.0",
    "openai>=1.0.0",
    "anthropic>=0.76.0",
    "openadapt-ml>=0.11.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "ruff>=0.1.0",
]
training = [
    "imagehash>=4.3.0",
]
verl = [
    "verl>=0.3.0",
]

[tool.uv.sources]
openadapt-ml = { path = "../openadapt-ml", editable = true }

[tool.hatch.build.targets.wheel]
packages = ["openadapt_evals"]
`
    touchFile(tempDir, 'pyproject.toml', pyprojectContent)

    stripHeavyPyDeps(tempDir)

    const result = readFileSync(join(tempDir, 'pyproject.toml'), 'utf-8')
    // Heavy base dep should be stripped
    expect(result).not.toContain('open-clip-torch')
    // Optional deps section entirely removed
    expect(result).not.toContain('[project.optional-dependencies]')
    expect(result).not.toContain('verl')
    // Lightweight base deps preserved
    expect(result).toContain('pillow>=10.0.0')
    expect(result).toContain('requests>=2.28.0')
    expect(result).toContain('openai>=1.0.0')
    expect(result).toContain('anthropic>=0.76.0')
    expect(result).toContain('openadapt-ml>=0.11.0')
    // Other sections preserved
    expect(result).toContain('[tool.uv.sources]')
    expect(result).toContain('[tool.hatch.build.targets.wheel]')
  })

  it('does nothing when pyproject.toml does not exist', () => {
    expect(() => stripHeavyPyDeps(tempDir)).not.toThrow()
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
