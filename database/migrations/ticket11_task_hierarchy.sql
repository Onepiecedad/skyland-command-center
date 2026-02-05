-- Migration: Ticket 11 - Task Hierarchy + Task Runs
-- Run this in Supabase SQL Editor to apply schema changes
-- ============================================================================
-- 1. Add columns to tasks table
-- ============================================================================
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE
SET NULL;
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS executor TEXT NOT NULL DEFAULT 'local:echo';
-- Index for parent lookups
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
-- ============================================================================
-- 2. Create task_runs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_number INT NOT NULL,
    executor TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'queued',
            'running',
            'completed',
            'failed',
            'cancelled',
            'timeout'
        )
    ),
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    worker_id TEXT,
    input_snapshot JSONB,
    output JSONB NOT NULL DEFAULT '{}',
    error JSONB NOT NULL DEFAULT '{}',
    metrics JSONB NOT NULL DEFAULT '{}'
);
-- Unique constraint: one run_number per task
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_task_number ON task_runs(task_id, run_number);
-- Index for listing runs by task
CREATE INDEX IF NOT EXISTS idx_task_runs_task_queued ON task_runs(task_id, queued_at DESC);
-- ============================================================================
-- Verification queries (run after migration)
-- ============================================================================
-- Check tasks table columns:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks';
-- Check task_runs table exists:
-- SELECT * FROM task_runs LIMIT 1;