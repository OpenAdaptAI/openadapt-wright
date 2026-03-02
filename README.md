# Wright

Wright is a generalized dev automation platform that takes task descriptions, uses the Claude Agent SDK to generate code, runs tests iteratively (the Ralph Loop pattern), and creates pull requests -- with a Telegram bot for human-in-the-loop approval.

## Architecture

```
                         Telegram
                            |
                     +------v------+
                     |   Crier     |  (notifications)
                     +------+------+
                            |
  GitHub Issue/PR     +-----v-----+     +-----------+
  ────────────────>   |  Herald   |────>|  Wright   |
                      +-----------+     |  Worker   |
                       (webhooks)       +-----+-----+
                                              |
                                        +-----v-----+
                                        | Claude SDK |
                                        |  Dev Loop  |
                                        +-----+-----+
                                              |
                                     +--------v--------+
                                     | clone -> edit   |
                                     | -> test -> fix  |  (Ralph Loop)
                                     | -> repeat       |
                                     +--------+--------+
                                              |
                                        +-----v-----+
                                        |  GitHub PR |
                                        +-----------+
```

### Ecosystem

Wright is part of the OpenAdapt automation ecosystem:

- **Consilium** -- project management and task decomposition
- **Herald** -- GitHub webhook listener, routes events to wright
- **Crier** -- multi-channel notification service (Telegram, etc.)
- **Wright** -- dev automation worker (this repo)

### How it works

1. A task arrives (via Herald webhook, Telegram command, or direct API call)
2. Wright claims the job from the Supabase queue
3. The worker clones the target repo, creates a branch
4. Claude Agent SDK iterates: edit code, run tests, fix failures (Ralph Loop)
5. On success (or budget exhaustion), wright creates a PR
6. Crier notifies the human via Telegram for review/approval

## Monorepo Structure

```
wright/
  apps/
    worker/       # Fly.io: generalized dev loop (scale-to-zero)
    bot/          # Fly.io: always-on Telegram bot
  packages/
    shared/       # Shared types + constants
  supabase/
    migrations/   # Database schema
```

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm 9+
pnpm install
pnpm build

# Set environment variables (see .env.example -- TODO)
# Run the worker locally
pnpm --filter @wright/worker dev

# Run the Telegram bot locally
pnpm --filter @wright/bot dev
```

## Plan

See the full design document: [wright plan](https://github.com/OpenAdaptAI/openadapt-wright/blob/main/PLAN.md)
