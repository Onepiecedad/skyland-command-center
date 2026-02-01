-- Skyland Command Center Database Schema v1.1
-- PostgreSQL with pgcrypto extension

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- ACTIVITIES TABLE
-- ============================================================================
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  autonomy_level TEXT DEFAULT 'OBSERVE' CHECK (autonomy_level IN ('OBSERVE', 'SUGGEST', 'ACT', 'SILENT')),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_customer ON activities(customer_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_event_type ON activities(event_type);
CREATE INDEX idx_activities_severity ON activities(severity);

-- ============================================================================
-- TASKS TABLE
-- ============================================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_agent TEXT,
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'assigned', 'in_progress', 'review', 'completed', 'failed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(assigned_agent);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id UUID,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  channel TEXT DEFAULT 'chat' CHECK (channel IN ('chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook')),
  direction TEXT DEFAULT 'internal' CHECK (direction IN ('internal', 'inbound', 'outbound')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_direction ON messages(direction);

-- ============================================================================
-- AGENT CONFIGS TABLE
-- ============================================================================
CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  autonomy_defaults JSONB DEFAULT '{}',
  triggers JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- CUSTOMER STATUS VIEW (HÄRLEDD STATUS)
-- ============================================================================
CREATE OR REPLACE VIEW customer_status AS
WITH recent_activities AS (
  SELECT 
    customer_id,
    COUNT(*) FILTER (WHERE severity = 'error' AND created_at > now() - interval '24 hours') as errors_24h,
    COUNT(*) FILTER (WHERE severity = 'warn' AND created_at > now() - interval '24 hours') as warnings_24h,
    MAX(created_at) as last_activity
  FROM activities
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
),
pending_tasks AS (
  SELECT 
    customer_id,
    COUNT(*) FILTER (WHERE status IN ('created', 'assigned', 'in_progress', 'review')) as open_tasks,
    COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours') as failed_tasks_24h
  FROM tasks
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
)
SELECT 
  c.id,
  c.name,
  c.slug,
  COALESCE(ra.errors_24h, 0) as errors_24h,
  COALESCE(ra.warnings_24h, 0) as warnings_24h,
  COALESCE(pt.open_tasks, 0) as open_tasks,
  COALESCE(pt.failed_tasks_24h, 0) as failed_tasks_24h,
  ra.last_activity,
  CASE 
    WHEN COALESCE(ra.errors_24h, 0) > 0 OR COALESCE(pt.failed_tasks_24h, 0) > 0 THEN 'error'
    WHEN COALESCE(ra.warnings_24h, 0) > 2 OR COALESCE(pt.open_tasks, 0) > 10 THEN 'warning'
    ELSE 'active'
  END as status
FROM customers c
LEFT JOIN recent_activities ra ON ra.customer_id = c.id
LEFT JOIN pending_tasks pt ON pt.customer_id = c.id;
