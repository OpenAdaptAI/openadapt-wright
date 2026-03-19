# Wright Productization Plan

## 1. Market Context

The AI code assistant market is projected at $4.7B with a 15% CAGR. The current landscape includes several well-funded players:

| Product | Pricing | Model |
|---------|---------|-------|
| Devin (Cognition) | $20-500/mo | Per-seat subscription |
| Codex (OpenAI) | Bundled with ChatGPT Pro/Team | Usage-based via platform |
| GitHub Copilot | $10-39/mo per seat | Per-seat subscription |
| Cursor | $20/mo | Per-seat subscription |
| Cody (Sourcegraph) | $9-19/mo | Per-seat subscription |

### Where Wright Fits

Most competitors focus on **real-time code completion** (Copilot, Cursor, Cody) or **autonomous task execution** (Devin, Codex). Wright occupies a unique position:

- **Async, test-driven task execution** -- not a code completion tool, not a chat assistant
- **Telegram-native workflow** -- submit tasks from mobile, get notified when PRs are ready
- **Open-source core** -- no vendor lock-in, self-hostable
- **Language-agnostic** -- Python, TypeScript, Rust, Go out of the box
- **Part of the OpenAdapt ecosystem** -- integrates with Herald (webhooks), Crier (notifications), Consilium (multi-LLM consensus)

The closest competitor is Devin, but Devin is a closed SaaS product starting at $500/mo for teams. Wright's open-source model and lower price point target a different segment: small teams and individual developers who want automated bug fixes and feature implementation without enterprise pricing.

---

## 2. What Wright Already Has

Wright is not a concept -- it is a working system with the following components deployed:

### Infrastructure
- **Supabase job queue** -- `job_queue`, `job_events`, `test_results` tables with RLS
- **Telegram bot** (grammY) -- task submission, status queries, cancellation, revision workflow
- **Fly.io workers** -- scale-to-zero, graceful shutdown with job re-queuing
- **CI/CD** -- GitHub Actions for lint, test, build; Fly.io deploy on merge

### Core Logic (Ralph Loop)
- **Auto-detection** of test runners (pytest, playwright, jest, vitest, go-test, cargo-test) and package managers (uv, pip, poetry, npm, pnpm, yarn, cargo, go)
- **Claude Agent SDK integration** -- iterative edit-test-fix loops with budget tracking
- **PR creation** -- automatic branch creation, commit, push, and PR on success
- **Revision workflow** -- users can request changes on existing PRs via Telegram

### Test Coverage
- **53 tests** across 6 suites covering detection, parsing, git ops, dev loop, queue management
- **End-to-end flow verified** with mocked externals (clone -> detect -> install -> loop -> commit -> PR)

### What's Missing for Product
- GitHub App (currently uses PAT tokens)
- Web UI (currently Telegram-only)
- Billing/metering
- Multi-tenant isolation (no user_id/org_id in schema)
- Usage dashboards
- Sandboxed execution (workers share host)

---

## 3. Pricing Model

### Hybrid Subscription + Per-Task

| Tier | Price | Included Tasks | Private Repos | Features |
|------|-------|---------------|---------------|----------|
| **Free** | $0/mo | 3 tasks/month | No (public only) | Telegram bot, basic PR creation |
| **Pro** | $29/mo | 20 tasks/month | Yes | Web UI, priority queue, Slack notifications |
| **Team** | $99/mo | 100 tasks/month | Yes | GitHub App install, org-wide settings, team dashboard |
| **Enterprise** | Custom | Unlimited | Yes | Self-hosted, SSO, audit logs, dedicated workers |

### Overage Pricing
- **Free tier**: Hard cap at 3 tasks, no overage
- **Pro**: $5/task overage
- **Team**: $3/task overage
- **Enterprise**: Included in contract

### Why Hybrid

Pure per-task pricing (like Devin's credit system) creates unpredictable bills. Pure subscription (like Copilot) doesn't account for the variable compute cost of each task. The hybrid model gives users a predictable base cost with transparent overage.

### Unit Economics

| Metric | Value |
|--------|-------|
| Claude API cost per task | $0.50 - $5.00 (median ~$1.50) |
| Fly.io compute per task | $0.01 - $0.10 |
| Supabase per task | <$0.01 |
| **Total COGS per task** | **$0.50 - $5.10** |
| Selling price per task | $5 - $15 (implied by tier) |
| **Gross margin** | **50-90%** |

The Pro tier at $29/mo with 20 included tasks implies $1.45/task. At median COGS of $1.60, the subscription itself is roughly break-even -- profit comes from overage and upsell to Team/Enterprise. The Team tier at $99/mo for 100 tasks ($0.99/task implied) requires volume to be profitable, but the GitHub App integration and team features justify the price.

---

## 4. MVP Roadmap (4-6 Weeks)

### Week 1-2: GitHub App Integration

**Goal**: Replace PAT tokens with a proper GitHub App for repo access.

**Why first**: PAT tokens are the biggest friction point. Users must generate and paste tokens manually, tokens have broad permissions, and they expire. A GitHub App provides scoped, per-repo permissions with a one-click install flow.

**Tasks**:
- Register a GitHub App (permissions: contents read/write, pull requests read/write, issues read)
- Implement OAuth callback for user authentication
- Store installation tokens in Supabase (encrypted)
- Update `dev-loop.ts` to use installation tokens instead of `github_token` field
- Add Supabase migration for `users` and `github_installations` tables

**Schema additions**:
```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id       BIGINT UNIQUE NOT NULL,
    github_login    TEXT NOT NULL,
    email           TEXT,
    plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
    stripe_customer_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE github_installations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    installation_id     BIGINT UNIQUE NOT NULL,
    account_login       TEXT NOT NULL,
    account_type        TEXT NOT NULL CHECK (account_type IN ('User', 'Organization')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_queue ADD COLUMN user_id UUID REFERENCES users(id);
ALTER TABLE job_queue ADD COLUMN org_id UUID REFERENCES github_installations(id);
```

### Week 2-3: Web UI for Task Submission

**Goal**: A web interface for submitting tasks and viewing job status.

**Stack**: Next.js 14 (App Router) + Supabase Auth + Tailwind CSS

**Pages**:
- `/` -- Landing page (what Wright does, pricing, get started)
- `/login` -- GitHub OAuth via Supabase Auth
- `/dashboard` -- List of jobs with status, cost, PR links
- `/new` -- Submit a new task (select repo from GitHub installations, describe task)
- `/jobs/[id]` -- Job detail view with event timeline and test results

**Why Next.js**: Supabase has first-class Next.js support (SSR, Auth helpers, Realtime). The monorepo already uses pnpm workspaces and Turbo, which works perfectly with Next.js.

### Week 3-4: Stripe Billing Integration

**Goal**: Meter task usage and charge for Pro/Team plans.

**Tasks**:
- Create Stripe products and prices for Free/Pro/Team tiers
- Implement Stripe Checkout for upgrades
- Add webhook handler for subscription lifecycle (created, updated, cancelled)
- Add task counting in `queue-poller.ts` (check plan limits before claiming)
- Add `subscriptions` table in Supabase
- Show billing status in web UI dashboard

### Week 4-5: Multi-Tenant Job Queue

**Goal**: Isolate jobs by user/org with proper RLS policies.

**Tasks**:
- Add `user_id` and `org_id` to job insert flow (web UI and bot)
- Create RLS policies: users can only see/manage their own jobs
- Update bot to link Telegram users to Wright accounts
- Add per-user rate limiting (tasks per month based on plan)
- Update worker to validate user plan before executing

### Week 5-6: Basic Sandboxing

**Goal**: Isolate each job's execution environment.

**Tasks**:
- Run each dev loop in a Docker container (instead of bare host)
- Set resource limits (CPU, memory, network, disk)
- Add timeout enforcement at the container level
- Prevent network access to internal services from job containers
- Clean up containers after job completion

---

## 5. Differentiation

### vs. Devin
- **Open source** -- Wright's core is MIT-licensed; Devin is closed SaaS
- **Price** -- Wright Pro at $29/mo vs Devin at $500/mo for teams
- **Test-driven** -- Ralph Loop ensures all changes pass tests before PR creation
- **Self-hostable** -- enterprises can run Wright on their own infrastructure

### vs. GitHub Copilot / Cursor
- **Async, not real-time** -- Wright handles complete tasks, not inline completions
- **No IDE required** -- submit via Telegram, web, or CLI; review on GitHub
- **Multi-language with auto-detection** -- no configuration needed per repo

### vs. Codex
- **Standalone product** -- not bundled with a larger platform
- **Telegram-native** -- mobile-first workflow for on-the-go task submission
- **Ecosystem** -- integrates with Herald, Crier, Consilium for full dev workflow automation

### Core Moats
1. **Ralph Loop** -- iterative test-driven development is fundamentally more reliable than single-shot code generation
2. **OpenAdapt ecosystem** -- Herald (webhooks) + Crier (notifications) + Wright (execution) + Consilium (consensus) creates a complete automation platform
3. **Community** -- open-source community contributions improve detection, parsing, and language support faster than any single team

---

## 6. Go-to-Market Strategy

### Phase 1: Developer Early Adopters (Months 1-3)

**Target**: Individual developers and small teams (2-10 engineers).

**Wedge use cases** (low-risk, high-frequency tasks):
- Bug fixes with test reproduction steps
- Dependency updates (security patches, version bumps)
- Documentation generation from code
- Test coverage expansion
- Linting/formatting standardization

**Channels**:
- Open-source community (GitHub, Discord)
- Developer-focused content (blog posts, demo videos)
- Telegram developer groups
- Hacker News / Reddit /r/programming launches

**Success metrics**:
- 100 registered users
- 500 tasks completed
- 10 paying Pro subscribers
- NPS > 40

### Phase 2: Team Adoption (Months 3-6)

**Target**: Engineering teams at startups and SMBs.

**Expansion triggers**:
- Individual user installs GitHub App on org repos
- Team lead sees PR quality and wants org-wide access
- GitHub App install on organization account

**Features needed**:
- Team dashboard with aggregate metrics
- Org-level settings (default budget, allowed repos, branch policies)
- Slack integration (alongside Telegram)
- Admin controls (approve/deny tasks from team members)

### Phase 3: Enterprise (Months 6-12)

**Target**: Engineering orgs with 50+ developers.

**Requirements**:
- Self-hosted deployment option
- SSO/SAML integration
- Audit logging
- Custom model selection (bring-your-own API key)
- SLA guarantees
- Compliance certifications (SOC 2)

---

## 7. Technical Architecture

### Current Architecture

```
  Telegram Bot (grammY)
        |
        v
  Supabase (job_queue, job_events, test_results)
        |
        v
  Fly.io Worker (scale-to-zero)
        |
        v
  Claude Agent SDK (Ralph Loop)
        |
        v
  GitHub (clone, branch, commit, push, PR)
```

**Entry points**: Telegram bot only
**Auth**: PAT tokens stored in job_queue rows
**Billing**: None
**Isolation**: Shared worker host

### Target Architecture

```
  Web UI (Next.js)  +  Telegram Bot  +  CLI  +  Herald (webhooks)
        |                   |              |          |
        v                   v              v          v
  Supabase Auth  ────────────────────────────────────────>  users table
        |
        v
  Supabase (job_queue with user_id/org_id, RLS)
        |
        v
  Job Scheduler (plan limits, priority queue, rate limiting)
        |
        v
  Auto-scaling Workers (Fly.io Machines API)
        |
        v
  Docker Sandbox (per-job isolation)
        |
        v
  Claude Agent SDK (Ralph Loop)
        |
        v
  GitHub App API (installation tokens, scoped permissions)
        |
        v
  Stripe (metering, billing, webhooks)
```

**Entry points**: Web UI, Telegram bot, CLI, Herald webhooks
**Auth**: GitHub OAuth via Supabase Auth + GitHub App installations
**Billing**: Stripe subscriptions with task metering
**Isolation**: Docker container per job with resource limits

### Key Technical Decisions

1. **Next.js App Router** -- Supabase has first-class support, works with pnpm/Turbo monorepo
2. **Supabase Auth** -- GitHub OAuth provider built-in, ties directly to RLS policies
3. **Stripe** -- industry standard, well-documented, good Next.js libraries
4. **GitHub App** -- replaces PAT tokens with scoped, per-installation tokens
5. **Fly.io Machines API** -- programmatic scaling instead of static machine count
6. **Docker** -- lightweight isolation without full VM overhead

---

## 8. Supabase Schema Evolution

### Current Schema (v1)
- `job_queue` -- tasks with `github_token`, `telegram_chat_id`
- `job_events` -- lifecycle events per job
- `test_results` -- test run outcomes per loop
- RLS: service_role only

### Target Schema (v2)
- `users` -- GitHub identity, plan, Stripe customer
- `github_installations` -- GitHub App installations per user/org
- `subscriptions` -- Stripe subscription state
- `usage` -- task counts per billing period
- `job_queue` -- add `user_id`, `org_id`; remove `github_token` (derived from installation)
- RLS: users see own jobs, org members see org jobs, service_role sees all

---

## 9. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Claude API costs exceed projections | High | Medium | Budget caps per task, pre-flight cost estimation, model tiering (Haiku for simple tasks) |
| Low task success rate hurts retention | High | Medium | Ralph Loop iteration, better test detection, fallback to human review |
| GitHub rate limiting | Medium | Low | Installation token rotation, request queuing, caching |
| Abuse (crypto mining, spam PRs) | Medium | Medium | Docker sandboxing, network isolation, task review queue for free tier |
| Competitor feature parity | Medium | High | Focus on open-source community, ecosystem integration, test-driven workflow |

---

## 10. Success Metrics

### MVP Launch (Week 6)
- Web UI live with task submission
- GitHub App installable
- Stripe billing functional
- 3 pricing tiers available
- 0 PAT tokens in production

### Month 3
- 100+ registered users
- 500+ tasks completed
- $1,000+ MRR
- 95%+ task completion rate
- < 15 min median task completion time

### Month 6
- 500+ registered users
- 5,000+ tasks completed
- $10,000+ MRR
- 10+ Team plan subscribers
- Public roadmap with community input

### Month 12
- 2,000+ registered users
- 50,000+ tasks completed
- $50,000+ MRR
- Enterprise pilot customers
- Self-hosted deployment documentation
