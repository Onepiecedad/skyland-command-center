-- ============================================================================
-- COSTS TABLE - API spend tracking per provider/agent/day
-- ============================================================================
CREATE TABLE IF NOT EXISTS costs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    date date NOT NULL,
    provider text NOT NULL,
    model text,
    agent text NOT NULL,
    tokens_in int DEFAULT 0,
    tokens_out int DEFAULT 0,
    cost_usd numeric(10, 6) NOT NULL,
    call_count int DEFAULT 1,
    task_id uuid REFERENCES tasks(id) ON DELETE
    SET NULL,
        created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_costs_date ON costs(date);
CREATE INDEX IF NOT EXISTS idx_costs_provider ON costs(provider);
CREATE INDEX IF NOT EXISTS idx_costs_agent ON costs(agent);