# Wright CLI Tool — Design Plan

## Motivation

Wright currently requires Telegram to submit tasks and monitor progress. This creates friction for developers who want to stay in the terminal. A CLI tool provides a first-class developer experience: submit jobs, stream logs, and run the dev loop locally — all without leaving the shell.

The CLI becomes the **third entry point** into Wright, alongside the Telegram bot and the Herald webhook integration. All three share the same Supabase queue and worker infrastructure.

## 1. What the CLI Does

### Commands

| Command | Description |
|---------|-------------|
| `wright task <repo_url> <description>` | Submit a job to the Supabase queue (same as `/task` in Telegram) |
| `wright status [job_id]` | Show job status, recent events, cost. Without `job_id`, shows the most recent job. |
| `wright logs <job_id>` | Stream events in real-time via Supabase Realtime (like `fly logs` or `kubectl logs -f`) |
| `wright cancel <job_id>` | Cancel a queued or running job |
| `wright list` | List recent jobs (default: 10, with `--limit` flag) |
| `wright local <repo_url> <description>` | Run the dev loop locally — no Supabase, no worker, clone + Claude + test + PR directly |
| `wright config` | Show or set configuration (Supabase URL, keys, defaults) |

### Command Details

#### `wright task`

```
wright task <repo_url> <description> [options]

Options:
  --branch <branch>       Base branch (default: main)
  --max-loops <n>         Max edit-test-fix loops (default: 10)
  --budget <usd>          Max API spend in USD (default: 5.00)
  --follow                After submitting, immediately tail logs (like `wright logs`)
  --json                  Output job object as JSON (for scripting)
```

Submits a job to Supabase's `job_queue` table. The `telegram_chat_id` and `telegram_message_id` fields are set to `null` (no Telegram notification). The GitHub token comes from `GITHUB_TOKEN` env var or `~/.config/wright/config.json`.

When `--follow` is passed, after successful submission the CLI automatically enters the `logs` streaming mode for that job (same as `wright task ... && wright logs <id>`).

#### `wright status`

```
wright status [job_id] [options]

Options:
  --json    Output as JSON
```

If `job_id` is omitted, fetches the most recent job created by this user (requires storing a local "my jobs" cache or filtering by some user identifier — see Authentication section). Displays:

- Job ID (short), status, repo URL, task description
- Cost so far, loops completed
- PR URL (if created)
- Last 5 events with timestamps

#### `wright logs`

```
wright logs <job_id> [options]

Options:
  --since <timestamp>     Only show events after this time
  --no-follow             Fetch current events and exit (no streaming)
```

Opens a Supabase Realtime subscription on `job_events` filtered to the given `job_id`. Renders events as a live-updating terminal log:

```
[12:34:01] CLAIMED     Job claimed by worker
[12:34:05] CLONED      Repository cloned (jest, npm)
[12:34:10] LOOP_START  Dev loop iteration 1/10
[12:34:45] EDIT        Files edited: src/utils.ts (200 chars)
[12:34:50] TEST_RUN    Running tests...
[12:34:58] TEST_FAIL   3 passed, 1 failed
[12:35:02] LOOP_START  Dev loop iteration 2/10
...
[12:36:30] TEST_PASS   4 passed, 0 failed
[12:36:35] PR_CREATED  https://github.com/org/repo/pull/42
[12:36:36] COMPLETED   Success (2 loops, $0.38)
```

Automatically exits when the job reaches a terminal state (`succeeded` or `failed`). Uses Supabase Realtime `postgres_changes` — the same mechanism the bot already uses in `subscribeToJobEvents()`.

#### `wright cancel`

```
wright cancel <job_id>
```

Sets the job status to `failed` with error `"Cancelled by user via CLI"`. Same logic as `cancelJob()` in `apps/bot/src/supabase.ts`. Only works on `queued`, `claimed`, or `running` jobs.

#### `wright list`

```
wright list [options]

Options:
  --limit <n>    Number of jobs to show (default: 10)
  --status <s>   Filter by status (queued, running, succeeded, failed)
  --json         Output as JSON
```

Fetches recent jobs from `job_queue`, ordered by `created_at DESC`. Renders as a table:

```
ID        STATUS     REPO                              TASK                    COST    AGE
a1b2c3d4  succeeded  github.com/org/repo               Fix login button        $0.38   2h ago
e5f6g7h8  running    github.com/org/other              Add rate limiting       $1.22   15m ago
i9j0k1l2  failed     github.com/org/lib                Update docs             $0.05   1d ago
```

#### `wright local`

```
wright local <repo_url> <description> [options]

Options:
  --branch <branch>       Base branch (default: main)
  --max-loops <n>         Max edit-test-fix loops (default: 10)
  --budget <usd>          Max API spend (default: 5.00)
  --model <model>         Claude model (default: claude-sonnet-4-20250514)
  --workdir <path>        Working directory (default: /tmp/wright-work/<uuid>)
  --keep-workdir          Don't delete the work directory after completion
  --dry-run               Clone and detect, but don't run Claude
```

Runs the full dev loop **locally** on the developer's machine. No Supabase required. No worker. The CLI directly calls `runDevLoop()` from `apps/worker/src/dev-loop.ts`, with events printed to stdout instead of inserted into Supabase.

This is the **power-user mode** — useful for:
- Development/testing of Wright itself
- Running without Supabase infrastructure
- Debugging job failures by re-running locally
- CI/CD pipelines that want to use Wright as a library

#### `wright config`

```
wright config                    # Show current config
wright config set <key> <value>  # Set a config value
wright config get <key>          # Get a config value
```

Configuration stored in `~/.config/wright/config.json`:

```json
{
  "supabase_url": "https://xyz.supabase.co",
  "supabase_key": "eyJ...",
  "github_token": "ghp_...",
  "default_branch": "main",
  "default_max_loops": 10,
  "default_budget_usd": 5.0,
  "default_model": "claude-sonnet-4-20250514"
}
```

Environment variables override config file values. Precedence: `env > config file > defaults`.

## 2. Architecture Decisions

### 2.1 Package Location: `apps/cli/`

The CLI goes in `apps/cli/`, not `packages/cli/`. Rationale:

- **`apps/` is for deployable/runnable entry points** (worker, bot, cli). The CLI is a standalone executable.
- **`packages/` is for shared libraries** (shared types/constants). The CLI is not imported by other packages.
- Consistent with the existing monorepo convention: `apps/worker` is the Fly.io worker, `apps/bot` is the Telegram bot, `apps/cli` is the terminal interface.

The pnpm workspace already includes `apps/*`, so `apps/cli` is automatically discovered.

### 2.2 CLI Framework: Commander.js

**Recommendation: Commander.js**

| Framework | Pros | Cons |
|-----------|------|------|
| **Commander.js** | Minimal, well-known, zero config, <50KB. Perfect for a tool with 7 commands. | No plugin system (not needed here). |
| oclif | Plugin architecture, auto-generated help, testing utils. | Heavy (100+ deps), designed for CLIs with 50+ commands. Over-engineered for 7 commands. |
| yargs | Powerful argument parsing, middleware. | More complex API than Commander for simple command trees. |
| Custom (process.argv) | Zero deps. | Reinventing argument parsing, help text, validation. |

Commander.js is the right choice because:
- Wright CLI has 7 commands with simple argument structures
- Commander gives us subcommands, `--help` generation, option parsing, and validation out of the box
- It is the most commonly used Node.js CLI framework (50k+ GitHub stars, used by `vue-cli`, `create-react-app`, etc.)
- The entire CLI framework adds ~40KB, while oclif would add megabytes of scaffolding we don't need

### 2.3 Authentication

The CLI needs three credentials:

| Credential | Purpose | Source (precedence order) |
|------------|---------|--------------------------|
| `SUPABASE_URL` | Connect to job queue | env > config file |
| `SUPABASE_KEY` | Authenticate to Supabase | env > config file |
| `GITHUB_TOKEN` | Push branches, create PRs | env > config file > `gh auth token` fallback |
| `ANTHROPIC_API_KEY` | Claude API (local mode only) | env > config file |

**Key type for Supabase**: The CLI should use the **anon key** (same as the bot), not the service role key. The anon key, combined with Supabase Row Level Security (RLS), is safe to distribute. The service role key bypasses RLS and should only live on the worker.

However, the current schema does not have RLS policies. Until RLS is implemented, the CLI will use `SUPABASE_KEY` which can be either anon or service role. The key is stored in `~/.config/wright/config.json` (file permissions `0600`) or passed via environment variable.

**GitHub token**: The CLI first checks `GITHUB_TOKEN` env var, then config file, then attempts `gh auth token` as a fallback (if the user has GitHub CLI installed and authenticated). This gives a zero-config experience for developers who already use `gh`.

**`wright local` mode credentials**: Only needs `GITHUB_TOKEN` and `ANTHROPIC_API_KEY`. No Supabase at all.

### 2.4 Real-time Event Streaming

For `wright logs`, the CLI uses Supabase Realtime — the same mechanism already used by the bot in `apps/bot/src/supabase.ts`:

```
subscribeToJobEvents(callback, jobId) → RealtimeChannel
```

The CLI will create its own Supabase client and subscribe to `postgres_changes` on the `job_events` table, filtered by `job_id`. Events are rendered as they arrive.

**Connection lifecycle:**
1. CLI creates Supabase client with anon key
2. Subscribes to `job_events` INSERT events for the given `job_id`
3. Also subscribes to `job_queue` UPDATE events for the same job (to detect terminal states)
4. On terminal state (`succeeded` or `failed`), unsubscribe and exit
5. On Ctrl+C, unsubscribe and exit cleanly

**Fallback for no-Realtime environments**: If Realtime fails to connect (e.g., Supabase plan doesn't include it), fall back to polling `getJobEvents()` every 2 seconds. The CLI should detect this automatically and log a warning.

### 2.5 Local Mode (`wright local`)

The local mode reuses `runDevLoop()` from `apps/worker/src/dev-loop.ts`. However, `runDevLoop` currently requires a Supabase client for event emission and test result storage. The local mode needs to work without Supabase.

**Approach: Event adapter pattern**

Create an `EventSink` interface in `@wright/shared`:

```typescript
interface EventSink {
  emit(jobId: string, eventType: string, loopNumber?: number, payload?: Record<string, unknown>): Promise<void>
  storeTestResults(jobId: string, loopNumber: number, results: TestResults): Promise<void>
}
```

Two implementations:
1. **`SupabaseEventSink`** — the current behavior, inserts into `job_events` and `test_results` tables (used by the worker)
2. **`ConsoleEventSink`** — prints events to stdout with timestamps and colors (used by `wright local`)

`runDevLoop` currently takes `DevLoopConfig` which includes `supabaseUrl` and `supabaseServiceKey`. Refactor to accept an `EventSink` instead. This is a non-breaking change: the worker constructs a `SupabaseEventSink`, the CLI constructs a `ConsoleEventSink`.

**Synthetic Job object**: `wright local` creates a `Job` object in memory (no database insert):

```typescript
const job: Job = {
  id: crypto.randomUUID(),
  repo_url: repoUrl,
  branch: options.branch ?? 'main',
  task: description,
  max_loops: options.maxLoops ?? DEFAULT_MAX_LOOPS,
  max_budget_usd: options.budget ?? DEFAULT_MAX_BUDGET_USD,
  status: 'running',
  total_cost_usd: 0,
  attempt: 1,
  max_attempts: 1,
  github_token: resolveGithubToken(),
  created_at: new Date().toISOString(),
}
```

## 3. Package Details

### Name and Publishing

- **Internal package name**: `@wright/cli`
- **npm publish name**: `openadapt-wright` (the `wright` name is likely taken on npm)
- **Binary name**: `wright` (via `package.json` `"bin"` field)

```json
{
  "name": "@wright/cli",
  "bin": {
    "wright": "./dist/cli.js"
  }
}
```

Users install with:
```bash
npm install -g openadapt-wright
# or
npx openadapt-wright task https://github.com/org/repo "Fix the bug"
```

### Dependencies

```json
{
  "dependencies": {
    "@wright/shared": "workspace:*",
    "@supabase/supabase-js": "^2.49.0",
    "commander": "^13.0.0",
    "chalk": "^5.4.0"
  }
}
```

- **`@wright/shared`**: Types, constants (Job, JobEvent, TABLES, JOB_STATUS, etc.)
- **`@supabase/supabase-js`**: Supabase client for remote commands (task, status, cancel, list, logs)
- **`commander`**: CLI framework
- **`chalk`**: Terminal colors for formatted output (status indicators, event types, etc.)

For the `local` command, the CLI additionally needs the worker's dev-loop module. Two options:

1. **Import from `@wright/worker`** (requires exposing `runDevLoop` as a package export)
2. **Extract dev-loop into `@wright/core`** (a new shared package)

Option 1 is simpler for Phase 3 (just add `"@wright/worker": "workspace:*"` and ensure `runDevLoop` is exported). Option 2 is cleaner architecturally but adds a new package to maintain. Recommendation: start with Option 1, refactor to Option 2 only if the dependency graph becomes awkward.

## 4. Implementation Phases

### Phase 1: Core Commands (task, status, cancel, list)

**Scope**: Submit jobs, query status, cancel, and list — all via Supabase REST (no Realtime needed).

**Files to create**:
- `apps/cli/package.json`
- `apps/cli/tsconfig.json`
- `apps/cli/src/cli.ts` — entry point, Commander setup, command registration
- `apps/cli/src/commands/task.ts` — submit job to Supabase
- `apps/cli/src/commands/status.ts` — fetch and display job status
- `apps/cli/src/commands/cancel.ts` — cancel a job
- `apps/cli/src/commands/list.ts` — list recent jobs
- `apps/cli/src/commands/config.ts` — show/set configuration
- `apps/cli/src/lib/supabase.ts` — Supabase client (reuse patterns from bot's supabase.ts)
- `apps/cli/src/lib/config.ts` — config file read/write (~/.config/wright/config.json)
- `apps/cli/src/lib/format.ts` — terminal formatting (table renderer, status colors, time ago)
- `apps/cli/src/lib/auth.ts` — credential resolution (env > config > gh auth token)

**Files to modify**:
- `pnpm-workspace.yaml` — already includes `apps/*`, no change needed
- Root `package.json` — add `"cli": "pnpm --filter @wright/cli"` script (optional convenience)

**Estimated effort**: 2-3 days

**Exit criteria**: `wright task`, `wright status`, `wright cancel`, `wright list` all work against the production Supabase instance. Jobs submitted via CLI are picked up by the Fly.io worker and visible in the Telegram bot.

### Phase 2: Real-time Log Streaming (logs)

**Scope**: `wright logs <job_id>` streams events live via Supabase Realtime.

**Files to create**:
- `apps/cli/src/commands/logs.ts` — Realtime subscription, formatted event rendering

**Files to modify**:
- `apps/cli/src/commands/task.ts` — add `--follow` flag that chains into `logs` after submission

**Key considerations**:
- Supabase Realtime requires WebSocket support. The `@supabase/supabase-js` client handles this natively in Node.js.
- Need graceful cleanup on Ctrl+C (unsubscribe from channel, close WebSocket).
- Polling fallback if Realtime is unavailable.
- Back-pressure: events arrive faster than they can be rendered? Unlikely for dev-loop events (max ~1/sec), but buffer if needed.

**Estimated effort**: 1-2 days

**Exit criteria**: `wright logs <job_id>` shows live events as the worker processes a job. Automatically exits on completion. `wright task --follow` submits and streams in one command.

### Phase 3: Local Mode (local)

**Scope**: `wright local` runs the entire dev loop on the developer's machine without Supabase.

**Files to create**:
- `apps/cli/src/commands/local.ts` — orchestrator for local mode
- `apps/cli/src/lib/console-event-sink.ts` — EventSink implementation that prints to terminal

**Files to modify**:
- `packages/shared/src/types.ts` — add `EventSink` interface
- `apps/worker/src/dev-loop.ts` — refactor `emit()` and `supabase.from('test_results').insert()` calls to use `EventSink` interface instead of raw Supabase client
- `apps/worker/package.json` — export `runDevLoop` (add `"exports"` field or adjust `"main"`)

**Refactoring `dev-loop.ts`**:

Currently `runDevLoop` takes `DevLoopConfig` which has `supabaseUrl` and `supabaseServiceKey`, and internally creates a Supabase client for event emission. The refactor:

1. Add `eventSink?: EventSink` to `DevLoopConfig`
2. If `eventSink` is provided, use it. Otherwise, construct a `SupabaseEventSink` from `supabaseUrl`/`supabaseServiceKey` (backward compatible).
3. Replace all `emit(supabase, ...)` calls with `eventSink.emit(...)`
4. Replace `supabase.from('test_results').insert(...)` with `eventSink.storeTestResults(...)`

This refactoring is backward-compatible: the worker continues to work exactly as before by passing `supabaseUrl`/`supabaseServiceKey`. The CLI passes a `ConsoleEventSink` and omits Supabase credentials.

**Estimated effort**: 2-3 days (includes the dev-loop refactoring)

**Exit criteria**: `wright local https://github.com/org/repo "Fix the bug"` clones the repo, runs Claude, runs tests, creates a PR, and prints all events to the terminal. No Supabase involved.

## 5. Key Files Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/cli/package.json` | Package manifest with `"bin": {"wright": ...}` |
| `apps/cli/tsconfig.json` | TypeScript config extending root |
| `apps/cli/src/cli.ts` | Entry point — Commander program definition |
| `apps/cli/src/commands/task.ts` | Submit job to queue |
| `apps/cli/src/commands/status.ts` | Show job status + events |
| `apps/cli/src/commands/cancel.ts` | Cancel a job |
| `apps/cli/src/commands/list.ts` | List recent jobs |
| `apps/cli/src/commands/logs.ts` | Real-time event streaming (Phase 2) |
| `apps/cli/src/commands/local.ts` | Local dev loop execution (Phase 3) |
| `apps/cli/src/commands/config.ts` | Configuration management |
| `apps/cli/src/lib/supabase.ts` | Supabase client singleton |
| `apps/cli/src/lib/config.ts` | Config file read/write |
| `apps/cli/src/lib/format.ts` | Terminal formatting utilities |
| `apps/cli/src/lib/auth.ts` | Credential resolution |
| `apps/cli/src/lib/console-event-sink.ts` | EventSink for local mode (Phase 3) |

### Modified Files

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Add `EventSink` interface (Phase 3) |
| `apps/worker/src/dev-loop.ts` | Accept `EventSink`, refactor emit calls (Phase 3) |
| `apps/worker/package.json` | Export `runDevLoop` for CLI consumption (Phase 3) |

## 6. Tradeoffs and Recommendations

### Supabase Anon Key vs Service Role Key

**Tradeoff**: The anon key is safe to distribute but requires RLS policies. The service role key bypasses RLS but should never be on client machines.

**Recommendation**: Use the anon key for the CLI. Add RLS policies to `job_queue` and `job_events` tables as part of Phase 1 setup. Minimum viable RLS: allow INSERT into `job_queue` (anyone can submit), allow SELECT on `job_queue` and `job_events` (anyone can view), restrict UPDATE/DELETE to service role (only workers can claim/complete).

If RLS is too much for Phase 1, use the service role key with clear documentation that it should be treated as a secret. The config file uses `0600` permissions.

### Extracting `@wright/core` vs Importing `@wright/worker`

**Tradeoff**: Importing `runDevLoop` from `@wright/worker` means the CLI depends on the worker package, which brings in Express, simple-git, and the Claude Agent SDK as transitive dependencies. Extracting a `@wright/core` package would keep the dependency graph cleaner.

**Recommendation**: Start with importing from `@wright/worker` in Phase 3. The transitive deps (Express, simple-git, Claude SDK) are all needed by the CLI's local mode anyway — it literally runs the same code. Extract `@wright/core` only if the worker grows features that the CLI should not depend on (e.g., Fly.io-specific scale-to-zero logic).

### npm Package Name

**Tradeoff**: `wright` is short but likely taken on npm. `openadapt-wright` is available and consistent with the GitHub repo name.

**Recommendation**: Publish as `openadapt-wright` on npm. The binary name is still `wright` (via the `"bin"` field). Users type `wright task ...` regardless of the npm package name. If `wright` becomes available, we can add it as an alias later.

### `--follow` Default Behavior

**Tradeoff**: Should `wright task` follow by default (like `docker run` with attached stdout) or should it submit and return (like `kubectl apply`)?

**Recommendation**: Do NOT follow by default. `wright task` should submit and return immediately with the job ID. The `--follow` flag opts into tailing. Rationale: developers may want to submit multiple jobs in quick succession, or submit from a script. Blocking by default would be surprising. The printed output will include a hint: `Run 'wright logs <job_id>' to follow progress.`

### Config File Location

**Tradeoff**: XDG spec says `~/.config/wright/config.json`. Some tools use `~/.wrightrc`. Others use `~/.<tool>.json`.

**Recommendation**: Follow XDG: `~/.config/wright/config.json`. Use `$XDG_CONFIG_HOME/wright/config.json` if the env var is set, otherwise `~/.config/wright/config.json`. This is the standard for modern CLI tools.

### Terminal Output Formatting

**Tradeoff**: Plain text vs rich formatting (colors, spinners, tables).

**Recommendation**: Use chalk for colors and a simple table formatter. No spinners (they complicate piping and logging). Support `--json` on all commands for machine-readable output. Respect `NO_COLOR` env var per the [no-color convention](https://no-color.org/). When stdout is not a TTY (piped), disable colors automatically.

### Testing Strategy

**Recommendation**: Follow the same testing pattern as the worker (vitest, mocked externals). Key test cases:

- **Command parsing**: Verify Commander parses arguments and options correctly
- **Supabase operations**: Mock Supabase client, verify correct table/column usage
- **Config file**: Test read/write/merge with env var overrides
- **Format utilities**: Test table rendering, time-ago formatting, event formatting
- **Local mode**: Reuse the worker's dev-loop test patterns with a ConsoleEventSink

## 7. Example Usage Session

```bash
# First-time setup
wright config set supabase_url https://xyz.supabase.co
wright config set supabase_key eyJ...
# GitHub token auto-detected from `gh auth token`

# Submit a task
$ wright task https://github.com/OpenAdaptAI/openadapt-wright "Add input validation to the /task command"
Job queued: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Repo:   https://github.com/OpenAdaptAI/openadapt-wright
Task:   Add input validation to the /task command
Budget: $5.00 (10 loops max)

Run 'wright logs a1b2c3d4' to follow progress.

# Check status later
$ wright status a1b2c3d4
Job a1b2c3d4  RUNNING
Repo:    github.com/OpenAdaptAI/openadapt-wright
Task:    Add input validation to the /task command
Cost:    $0.42
Loops:   3/10

Recent events:
  [12:34:01] CLAIMED      Job claimed by worker
  [12:34:05] CLONED       Repository cloned
  [12:34:10] LOOP_START   Dev loop iteration 1/10
  [12:34:45] EDIT         Files edited
  [12:34:58] TEST_FAIL    3 passed, 1 failed

# Stream logs in real-time
$ wright logs a1b2c3d4
[12:35:02] LOOP_START   Dev loop iteration 2/10
[12:35:30] EDIT         Files edited
[12:35:42] TEST_PASS    4 passed, 0 failed
[12:35:45] PR_CREATED   https://github.com/OpenAdaptAI/openadapt-wright/pull/42
[12:35:46] COMPLETED    Success (2 loops, $0.67)

# List all jobs
$ wright list
ID        STATUS     REPO                                        TASK                          COST    AGE
a1b2c3d4  succeeded  OpenAdaptAI/openadapt-wright                Add input validation          $0.67   5m
e5f6g7h8  failed     OpenAdaptAI/openadapt-herald                Fix RSS feed parser           $2.10   2h

# Run locally (no Supabase)
$ wright local https://github.com/OpenAdaptAI/openadapt-wright "Add --dry-run flag to deploy script"
[local] Cloning https://github.com/OpenAdaptAI/openadapt-wright...
[local] Detected: test_runner=vitest, package_manager=pnpm
[local] Installing dependencies...
[local] Loop 1/10 — running Claude session...
[local] Loop 1/10 — running tests...
[local] Tests: 53 passed, 1 failed
[local] Loop 2/10 — running Claude session...
[local] Loop 2/10 — running tests...
[local] Tests: 54 passed, 0 failed
[local] Committing and pushing...
[local] PR created: https://github.com/OpenAdaptAI/openadapt-wright/pull/43
[local] Done! 2 loops, $0.52
```
