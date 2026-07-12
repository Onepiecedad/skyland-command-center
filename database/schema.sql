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
  customer_id UUID REFERENCES customers(id) ON DELETE
  SET NULL,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
    autonomy_level TEXT DEFAULT 'OBSERVE' CHECK (
      autonomy_level IN ('OBSERVE', 'SUGGEST', 'ACT', 'SILENT')
    ),
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
  customer_id UUID REFERENCES customers(id) ON DELETE
  SET NULL,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE
  SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    assigned_agent TEXT,
    executor TEXT NOT NULL DEFAULT 'local:echo',
    status TEXT DEFAULT 'created' CHECK (
      status IN (
        'created',
        'assigned',
        'in_progress',
        'review',
        'completed',
        'failed'
      )
    ),
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
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE
  SET NULL,
    conversation_id UUID,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    channel TEXT DEFAULT 'chat' CHECK (
      channel IN (
        'chat',
        'voice',
        'email',
        'sms',
        'whatsapp',
        'webhook'
      )
    ),
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
CREATE OR REPLACE VIEW customer_status AS WITH recent_activities AS (
    SELECT customer_id,
      COUNT(*) FILTER (
        WHERE severity = 'error'
          AND created_at > now() - interval '24 hours'
      ) as errors_24h,
      COUNT(*) FILTER (
        WHERE severity = 'warn'
          AND created_at > now() - interval '24 hours'
      ) as warnings_24h,
      MAX(created_at) as last_activity
    FROM activities
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  pending_tasks AS (
    SELECT customer_id,
      COUNT(*) FILTER (
        WHERE status IN ('created', 'assigned', 'in_progress', 'review')
      ) as open_tasks,
      COUNT(*) FILTER (
        WHERE status = 'failed'
          AND updated_at > now() - interval '24 hours'
      ) as failed_tasks_24h
    FROM tasks
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  -- SCC-22/24: CRM signal per customer (additive, does not affect status).
  crm_contacts AS (
    SELECT customer_id, COUNT(*) as contacts_count
    FROM contacts
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  crm_opps AS (
    SELECT customer_id, COUNT(*) as open_opportunities
    FROM opportunities
    WHERE status = 'open' AND customer_id IS NOT NULL
    GROUP BY customer_id
  )
SELECT c.id,
  c.name,
  c.slug,
  COALESCE(ra.errors_24h, 0) as errors_24h,
  COALESCE(ra.warnings_24h, 0) as warnings_24h,
  COALESCE(pt.open_tasks, 0) as open_tasks,
  COALESCE(pt.failed_tasks_24h, 0) as failed_tasks_24h,
  ra.last_activity,
  CASE
    WHEN COALESCE(ra.errors_24h, 0) > 0
    OR COALESCE(pt.failed_tasks_24h, 0) > 0 THEN 'error'
    WHEN COALESCE(ra.warnings_24h, 0) > 2
    OR COALESCE(pt.open_tasks, 0) > 10 THEN 'warning'
    ELSE 'active'
  END as status,
  COALESCE(cc.contacts_count, 0) as contacts_count,
  COALESCE(co.open_opportunities, 0) as open_opportunities
FROM customers c
  LEFT JOIN recent_activities ra ON ra.customer_id = c.id
  LEFT JOIN pending_tasks pt ON pt.customer_id = c.id
  LEFT JOIN crm_contacts cc ON cc.customer_id = c.id
  LEFT JOIN crm_opps co ON co.customer_id = c.id;
-- ============================================================================
-- TASK RUNS TABLE (Run History/Logs)
-- ============================================================================
CREATE TABLE task_runs (
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
CREATE UNIQUE INDEX idx_task_runs_task_number ON task_runs(task_id, run_number);
CREATE INDEX idx_task_runs_task_queued ON task_runs(task_id, queued_at DESC);
-- ============================================================================
-- COSTS TABLE - API spend tracking per provider/agent/day
-- ============================================================================
CREATE TABLE costs (
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
CREATE INDEX idx_costs_date ON costs(date);
CREATE INDEX idx_costs_provider ON costs(provider);
CREATE INDEX idx_costs_agent ON costs(agent);
-- ============================================================================
-- CONTACTS TABLE (SCC-22, F1: CRM-kärnan)
-- Normaliserad kontaktentitet. Se database/migrations/ticket22_contacts.sql
-- ============================================================================
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  name text,
  email text,
  phone text,
  company text,
  website text,
  tags text[] NOT NULL DEFAULT '{}',
  custom jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'working', 'qualified', 'won', 'lost')),
  source text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_contacts_dedupe_key ON contacts(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_contacts_customer ON contacts(customer_id);
CREATE INDEX idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_status ON contacts(status);
CREATE INDEX idx_contacts_created ON contacts(created_at DESC);
-- ============================================================================
-- PIPELINES / STAGES / OPPORTUNITIES (SCC-24, F1)
-- Se database/migrations/ticket24_pipelines.sql
-- ============================================================================
CREATE TABLE pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_pipeline ON stages(pipeline_id, position);
CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES stages(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  value_sek numeric(12, 2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_opportunities_pipeline ON opportunities(pipeline_id);
CREATE INDEX idx_opportunities_stage ON opportunities(stage_id);
CREATE INDEX idx_opportunities_contact ON opportunities(contact_id);