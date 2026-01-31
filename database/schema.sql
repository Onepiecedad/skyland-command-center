-- Skyland Command Center Database Schema v1.1
-- PostgreSQL with pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_customers_slug ON customers(slug);
CREATE INDEX idx_customers_created_at ON customers(created_at);
-- ============================================================================
-- ACTIVITIES TABLE
-- ============================================================================
CREATE TYPE activity_level AS ENUM ('info', 'warning', 'error', 'success');
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    level activity_level NOT NULL DEFAULT 'info',
    source VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activities_customer_id ON activities(customer_id);
CREATE INDEX idx_activities_level ON activities(level);
CREATE INDEX idx_activities_source ON activities(source);
CREATE INDEX idx_activities_created_at ON activities(created_at);
CREATE INDEX idx_activities_customer_created ON activities(customer_id, created_at DESC);
-- ============================================================================
-- TASKS TABLE
-- ============================================================================
CREATE TYPE task_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed',
    'cancelled'
);
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'pending',
    priority task_priority NOT NULL DEFAULT 'medium',
    assigned_agent VARCHAR(100),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tasks_customer_id ON tasks(customer_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_assigned_agent ON tasks(assigned_agent);
CREATE INDEX idx_tasks_due_at ON tasks(due_at);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_customer_status ON tasks(customer_id, status);
-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_channel AS ENUM (
    'email',
    'sms',
    'whatsapp',
    'chat',
    'phone',
    'portal'
);
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    direction message_direction NOT NULL,
    channel message_channel NOT NULL,
    sender VARCHAR(255),
    recipient VARCHAR(255),
    subject VARCHAR(500),
    body TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_customer_id ON messages(customer_id);
CREATE INDEX idx_messages_direction ON messages(direction);
CREATE INDEX idx_messages_channel ON messages(channel);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_customer_created ON messages(customer_id, created_at DESC);
-- ============================================================================
-- AGENT CONFIGS TABLE
-- ============================================================================
CREATE TABLE agent_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_configs_name ON agent_configs(name);
CREATE INDEX idx_agent_configs_is_active ON agent_configs(is_active);
-- ============================================================================
-- CUSTOMER STATUS VIEW
-- Aggregated view for dashboard with error/warning counts and status logic
-- ============================================================================
CREATE OR REPLACE VIEW customer_status AS
SELECT c.id,
    c.slug,
    c.name,
    c.domain,
    c.config,
    c.created_at,
    c.updated_at,
    -- Error count in last 24 hours
    COALESCE(
        (
            SELECT COUNT(*)
            FROM activities a
            WHERE a.customer_id = c.id
                AND a.level = 'error'
                AND a.created_at > NOW() - INTERVAL '24 hours'
        ),
        0
    )::INTEGER AS errors_24h,
    -- Warning count in last 24 hours
    COALESCE(
        (
            SELECT COUNT(*)
            FROM activities a
            WHERE a.customer_id = c.id
                AND a.level = 'warning'
                AND a.created_at > NOW() - INTERVAL '24 hours'
        ),
        0
    )::INTEGER AS warnings_24h,
    -- Open tasks count (pending or in_progress)
    COALESCE(
        (
            SELECT COUNT(*)
            FROM tasks t
            WHERE t.customer_id = c.id
                AND t.status IN ('pending', 'in_progress')
        ),
        0
    )::INTEGER AS open_tasks,
    -- Failed tasks in last 24 hours
    COALESCE(
        (
            SELECT COUNT(*)
            FROM tasks t
            WHERE t.customer_id = c.id
                AND t.status = 'failed'
                AND t.updated_at > NOW() - INTERVAL '24 hours'
        ),
        0
    )::INTEGER AS failed_tasks_24h,
    -- Last activity timestamp
    (
        SELECT MAX(a.created_at)
        FROM activities a
        WHERE a.customer_id = c.id
    ) AS last_activity,
    -- Status logic: error > warning > healthy
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM activities a
            WHERE a.customer_id = c.id
                AND a.level = 'error'
                AND a.created_at > NOW() - INTERVAL '24 hours'
        ) THEN 'error'
        WHEN EXISTS (
            SELECT 1
            FROM activities a
            WHERE a.customer_id = c.id
                AND a.level = 'warning'
                AND a.created_at > NOW() - INTERVAL '24 hours'
        ) THEN 'warning'
        WHEN EXISTS (
            SELECT 1
            FROM tasks t
            WHERE t.customer_id = c.id
                AND t.status = 'failed'
                AND t.updated_at > NOW() - INTERVAL '24 hours'
        ) THEN 'warning'
        ELSE 'healthy'
    END AS status
FROM customers c;
-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Apply trigger to tables with updated_at
CREATE TRIGGER update_customers_updated_at BEFORE
UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE
UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_configs_updated_at BEFORE
UPDATE ON agent_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();