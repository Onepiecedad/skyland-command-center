-- ============================================================================
-- CE-12 (fix 2) — append-only spärren gjorde ce_leads odeletbar
-- ON DELETE CASCADE från ce_leads triggade DELETE-spärren, vilket i praktiken
-- gjorde hård radering omöjlig. UPDATE förblir alltid förbjudet; DELETE kräver
-- en uttrycklig session-flagga som applikationskoden aldrig sätter.
-- ============================================================================

CREATE OR REPLACE FUNCTION ce_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND COALESCE(current_setting('app.allow_event_purge', true), 'false') = 'true' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ce_lead_events är append-only (försökte %). Hård radering kräver app.allow_event_purge.', TG_OP;
END;
$$;

COMMENT ON FUNCTION ce_events_append_only() IS
    'UPDATE alltid blockerat. DELETE endast med SET LOCAL app.allow_event_purge = true — avsett för full GDPR-radering och testrensning, aldrig för applikationskod.';
;
