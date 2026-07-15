-- ============================================================================
-- SCC-40 — SEKVENSMOTOR (GHL-ersättning: workflows/automations)
-- Native motor för fleredstegs-sekvenser: skicka mejl/SMS → vänta → gren →
-- flytta stage → tagga → avsluta. Ersätter GoHighLevels workflow-byggare.
-- Idempotent: kan köras flera gånger.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- sequences — en namngiven automation (t.ex. "Cold Email Drip")
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    -- vad som startar sekvensen
    trigger_type text NOT NULL DEFAULT 'manual'
        CHECK (trigger_type IN (
            'manual', 'contact_created', 'opportunity_created',
            'stage_changed', 'booking_created', 'tag_added', 'reply_received'
        )),
    trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,  -- t.ex. {"pipeline_id":..,"stage_id":..}
    -- vad som avslutar en enrollment i förtid (t.ex. ["reply_received","booking_created"])
    exit_on jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- hindra dubbel-enrollment av samma kontakt medan aktiv
    allow_reenroll boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sequences_status ON sequences(status);
CREATE INDEX IF NOT EXISTS idx_sequences_trigger ON sequences(trigger_type) WHERE status = 'active';

-- --------------------------------------------------------------------------
-- sequence_steps — ordnade steg i en sekvens
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    position int NOT NULL DEFAULT 0,
    type text NOT NULL CHECK (type IN (
        'send_email', 'send_sms', 'wait', 'branch',
        'move_stage', 'add_tag', 'remove_tag', 'create_task', 'webhook', 'exit'
    )),
    -- per-typ-config, t.ex.
    --   send_email: {"subject":..,"body":..,"template_id":..}
    --   wait:       {"minutes":.. } eller {"days":..}
    --   branch:     {"condition":"has_replied","then_exit":true}
    --   move_stage: {"pipeline_id":..,"stage_id":..}
    --   add_tag:    {"tag":"contacted"}
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_seq ON sequence_steps(sequence_id, position);

-- --------------------------------------------------------------------------
-- sequence_enrollments — en kontakt inskriven i en sekvens
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'exited', 'failed')),
    current_position int NOT NULL DEFAULT 0,        -- vilket steg som körs härnäst
    next_run_at timestamptz NOT NULL DEFAULT now(), -- när runnern ska plocka upp den
    context jsonb NOT NULL DEFAULT '{}'::jsonb,      -- variabler under körning
    exit_reason text,
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
-- runnerns hetväg: aktiva enrollments som är due
CREATE INDEX IF NOT EXISTS idx_enroll_due
    ON sequence_enrollments(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enroll_contact ON sequence_enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_enroll_sequence ON sequence_enrollments(sequence_id);
-- en aktiv enrollment per (sekvens, kontakt) om inte re-enroll tillåts
CREATE UNIQUE INDEX IF NOT EXISTS uq_enroll_active
    ON sequence_enrollments(sequence_id, contact_id) WHERE status = 'active';

-- --------------------------------------------------------------------------
-- sequence_step_runs — audit av varje kört steg (observability, som GHL:s historik)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_step_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
    step_id uuid REFERENCES sequence_steps(id) ON DELETE SET NULL,
    step_type text NOT NULL,
    status text NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    ran_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_step_runs_enroll ON sequence_step_runs(enrollment_id, ran_at);

-- --------------------------------------------------------------------------
-- Notering: RLS lämnas AVSTÄNGT i linje med övriga kärntabeller (internt bakom
-- Bearer-token). Måste stängas på före extern kunddata — se CLAUDE.md.
-- --------------------------------------------------------------------------
