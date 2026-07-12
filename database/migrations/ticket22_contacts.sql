-- ============================================================================
-- SCC-22 — CONTACTS TABLE (F1: CRM-kärnan)
-- Normaliserad kontaktentitet. Leads slutar leva som activities-rader.
-- Idempotent: kan köras flera gånger (IF NOT EXISTS överallt).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    name text,
    email text,
    phone text,
    company text,
    website text,
    tags text[] NOT NULL DEFAULT '{}',
    custom jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'working', 'qualified', 'won', 'lost')),
    source text,
    -- Same dedupe key that routes/leads.ts already computes for the intake,
    -- so a lead arriving twice upserts one contact instead of creating two.
    dedupe_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_dedupe_key
    ON contacts(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at DESC);

-- ----------------------------------------------------------------------------
-- Backfill: create a contact from every existing lead-activity that we have
-- not already migrated. Matches on dedupe_key so re-running is safe.
-- ----------------------------------------------------------------------------
INSERT INTO contacts (name, email, phone, company, website, status, source, dedupe_key, custom, created_at)
SELECT
    NULLIF(a.details->>'name', '')                          AS name,
    NULLIF(a.details->>'email', '')                         AS email,
    NULLIF(a.details->>'phone', '')                         AS phone,
    NULLIF(a.details->>'company', '')                       AS company,
    NULLIF(a.details->>'website', '')                       AS website,
    'new'                                                   AS status,
    COALESCE(a.details->>'source', 'lead')                  AS source,
    a.details->>'dedupe_key'                                AS dedupe_key,
    jsonb_build_object(
        'message',  a.details->>'message',
        'summary',  a.details->>'summary',
        'score',    a.details->>'score',
        'backfilled_from_activity', a.id
    )                                                       AS custom,
    a.created_at
FROM activities a
WHERE a.event_type = 'lead'
  AND a.details->>'dedupe_key' IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM contacts c WHERE c.dedupe_key = a.details->>'dedupe_key'
  );
