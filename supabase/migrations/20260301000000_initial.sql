-- Wright initial schema
-- Tables: job_queue, job_events, test_results

-- gen_random_uuid() is built-in to PostgreSQL 13+

-- ============================================================
-- job_queue: main task queue for dev automation jobs
-- ============================================================
CREATE TABLE job_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_url        TEXT NOT NULL,
    branch          TEXT NOT NULL DEFAULT 'main',
    task            TEXT NOT NULL,
    test_runner     TEXT,  -- auto-detected if null: pytest, playwright, jest, vitest, go-test, cargo-test, custom
    package_manager TEXT,  -- auto-detected if null: npm, pnpm, yarn, pip, uv, poetry, cargo, go, none
    max_loops       INTEGER NOT NULL DEFAULT 10,
    max_budget_usd  NUMERIC(10, 4) NOT NULL DEFAULT 5.0,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'claimed', 'running', 'succeeded', 'failed')),
    worker_id       TEXT,
    pr_url          TEXT,
    total_cost_usd  NUMERIC(10, 4) NOT NULL DEFAULT 0.0,

    -- Retry handling
    attempt         INTEGER NOT NULL DEFAULT 1,
    max_attempts    INTEGER NOT NULL DEFAULT 3,

    -- GitHub token for repo access
    github_token    TEXT NOT NULL,

    -- Telegram integration
    telegram_chat_id    BIGINT,
    telegram_message_id BIGINT,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,

    -- Error details on failure
    error           TEXT
);

-- Index for the worker poll query: find oldest unclaimed job
CREATE INDEX idx_job_queue_status_created
    ON job_queue (status, created_at ASC)
    WHERE status = 'queued';

-- Index for looking up jobs by worker
CREATE INDEX idx_job_queue_worker
    ON job_queue (worker_id)
    WHERE worker_id IS NOT NULL;

-- ============================================================
-- job_events: observability log for job lifecycle
-- ============================================================
CREATE TABLE job_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES job_queue(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                        'claimed', 'cloned', 'loop_start', 'edit',
                        'test_run', 'test_pass', 'test_fail',
                        'pr_created', 'completed', 'error', 'budget_exceeded'
                    )),
    loop_number     INTEGER,
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_events_job_id
    ON job_events (job_id, created_at ASC);

-- ============================================================
-- test_results: detailed test run outcomes per loop iteration
-- ============================================================
CREATE TABLE test_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES job_queue(id) ON DELETE CASCADE,
    loop_number     INTEGER NOT NULL,
    passed          INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    skipped         INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    duration        NUMERIC(10, 3) NOT NULL DEFAULT 0.0,  -- seconds
    failures        JSONB NOT NULL DEFAULT '[]'::JSONB,
    raw             TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_results_job_id
    ON test_results (job_id, loop_number ASC);

-- ============================================================
-- Row Level Security (RLS) -- enable but leave policies for later
-- ============================================================
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (workers use service key)
CREATE POLICY "service_role_all" ON job_queue
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON job_events
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON test_results
    FOR ALL USING (auth.role() = 'service_role');
