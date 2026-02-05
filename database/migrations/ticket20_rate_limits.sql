-- Migration: Ticket 20 - Rate Limit Tracking
-- Run this in Supabase SQL Editor to apply schema changes
-- ============================================================================
-- Add rate limit tracking columns to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS rate_limited_at TIMESTAMPTZ;
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS rate_limit_reason TEXT;
-- Add comment for documentation
COMMENT ON COLUMN tasks.rate_limited_at IS 'Timestamp when task was last rate limited during dispatch';
COMMENT ON COLUMN tasks.rate_limit_reason IS 'Reason for rate limit: concurrent_limit | hourly_limit';
-- ============================================================================
-- Verification queries (run after migration)
-- ============================================================================
-- Check new columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'tasks' AND column_name IN ('rate_limited_at', 'rate_limit_reason');