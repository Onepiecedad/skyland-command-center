-- ============================================================================
-- SCC-45 / SEQ-6 — BOOKINGS (Cal.com-spegel) + sekvens-triggers för bokning
-- SCC äger inte bokningslogiken (Cal.com gör det) — vi speglar den och triggar
-- sekvenser på skapad/avbokad/no-show. Idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
    external_id text UNIQUE,          -- Cal.com booking uid
    title text,
    attendee_email text,
    attendee_name text,
    starts_at timestamptz,
    ends_at timestamptz,
    status text NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked', 'cancelled', 'rescheduled', 'no_show', 'completed')),
    source text NOT NULL DEFAULT 'calcom',
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_contact ON bookings(contact_id);
CREATE INDEX IF NOT EXISTS idx_bookings_external ON bookings(external_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);

-- Utöka sekvens-triggers med bokningshändelser (för no-show-uppföljning m.m.)
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS sequences_trigger_type_check;
ALTER TABLE sequences ADD CONSTRAINT sequences_trigger_type_check
    CHECK (trigger_type IN (
        'manual', 'contact_created', 'opportunity_created', 'stage_changed',
        'booking_created', 'booking_cancelled', 'booking_no_show',
        'tag_added', 'reply_received'
    ));
