-- ============================================================================
-- SCC-24 — PIPELINES / STAGES / OPPORTUNITIES (F1: CRM-kärnan)
-- Deal-/stage-modell så kontakter kan flyttas genom en säljtratt.
-- Idempotent: kan köras flera gånger.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pipelines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    name text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name text NOT NULL,
    position int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON stages(pipeline_id, position);

CREATE TABLE IF NOT EXISTS opportunities (
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
CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline ON opportunities(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_contact ON opportunities(contact_id);

-- ----------------------------------------------------------------------------
-- Seed: one default pipeline with the standard local-service sales funnel.
-- Only created if no default pipeline exists yet (safe to re-run).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    pid uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pipelines WHERE is_default) THEN
        INSERT INTO pipelines (name, is_default) VALUES ('Sales', true) RETURNING id INTO pid;
        INSERT INTO stages (pipeline_id, name, position) VALUES
            (pid, 'New',       0),
            (pid, 'Contacted', 1),
            (pid, 'Qualified', 2),
            (pid, 'Proposal',  3),
            (pid, 'Won',       4),
            (pid, 'Lost',      5);
    END IF;
END $$;
