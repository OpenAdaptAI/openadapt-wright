-- Add heartbeat_at column for worker liveness detection.
-- Workers update this timestamp every 30s while processing a job.
-- The bot-side reaper checks for stale heartbeats every 60s and
-- re-queues jobs whose workers have stopped responding.
ALTER TABLE job_queue ADD COLUMN heartbeat_at TIMESTAMPTZ;
