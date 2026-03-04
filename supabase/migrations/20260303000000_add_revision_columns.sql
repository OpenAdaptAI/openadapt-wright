-- Add columns for PR revision support
-- feature_branch: the existing branch to push to (e.g. wright/14da897c)
-- parent_job_id: the original job this revision is based on

ALTER TABLE job_queue ADD COLUMN feature_branch TEXT;
ALTER TABLE job_queue ADD COLUMN parent_job_id UUID REFERENCES job_queue(id);
