ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rate_limited_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rate_limit_reason TEXT;
COMMENT ON COLUMN tasks.rate_limited_at IS 'Timestamp when task was last rate limited during dispatch';
COMMENT ON COLUMN tasks.rate_limit_reason IS 'Reason for rate limit: concurrent_limit | hourly_limit';;
