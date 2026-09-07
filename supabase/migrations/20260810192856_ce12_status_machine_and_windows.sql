-- ============================================================================
-- CE-12 — STATUSMASKIN + append-only audit trail
-- Plus fönsterunderhåll (24h service window / 72h free entry point) som drivs
-- av ce_messages, eftersom faktisk leverans är det enda som får styra klockan.
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ce_lead_events — append-only. UPDATE och DELETE är spärrade i trigger.
-- Detta är faktureringsunderlaget (CE-42) och attributionskedjan.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ce_lead_events (
    id          bigserial PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id     uuid NOT NULL REFERENCES ce_leads(id) ON DELETE CASCADE,
    event_type  text NOT NULL,          -- status_changed | human_takeover | opt_out | erase | note
    from_status text,
    to_status   text,
    actor       text NOT NULL DEFAULT 'system',   -- system | agent | joakim | gustav
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_events_lead ON ce_lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_events_tenant_type
    ON ce_lead_events(tenant_id, event_type, created_at DESC);

COMMENT ON TABLE ce_lead_events IS
    'Append-only. Statusövergångar, handoff, opt-out. Underlag för provisionsavstämning.';

CREATE OR REPLACE FUNCTION ce_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'ce_lead_events är append-only (försökte %)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_events_no_update ON ce_lead_events;
CREATE TRIGGER trg_ce_events_no_update
    BEFORE UPDATE OR DELETE ON ce_lead_events
    FOR EACH ROW EXECUTE FUNCTION ce_events_append_only();

-- ----------------------------------------------------------------------------
-- Tillåtna statusövergångar.
-- Framåtflödet är strikt; cold/nurture/opted_out nås från vilket läge som helst
-- (verkligheten gör det), och nurture/cold får återupptas till samtal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_valid_transition(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_from = p_to THEN true
        -- opted_out är slutgiltigt: bara GDPR-radering rör leadet efter det
        WHEN p_from = 'opted_out' THEN false
        -- avfarter tillåtna från alla aktiva lägen
        WHEN p_to IN ('cold', 'nurture', 'opted_out') THEN true
        -- återupptagning
        WHEN p_from IN ('cold', 'nurture') AND p_to IN ('contacted', 'in_conversation', 'qualifying', 'hot') THEN true
        WHEN p_from = 'new'             AND p_to IN ('contacted', 'in_conversation') THEN true
        WHEN p_from = 'contacted'       AND p_to IN ('in_conversation', 'qualifying', 'hot') THEN true
        WHEN p_from = 'in_conversation' AND p_to IN ('qualifying', 'hot', 'handed_off') THEN true
        WHEN p_from = 'qualifying'      AND p_to IN ('in_conversation', 'hot', 'handed_off') THEN true
        WHEN p_from = 'hot'             AND p_to IN ('handed_off', 'booked', 'in_conversation') THEN true
        WHEN p_from = 'handed_off'      AND p_to IN ('booked', 'in_conversation', 'hot') THEN true
        WHEN p_from = 'booked'          AND p_to IN ('paid', 'handed_off') THEN true
        WHEN p_from = 'paid'            AND p_to IN ('booked') THEN true
        ELSE false
    END
$$;

-- ----------------------------------------------------------------------------
-- Statustrigger: validerar övergången, stämplar milstolpar, loggar append-only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_leads_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('new', 'contacted', 'in_conversation') THEN
            RAISE EXCEPTION 'Nytt lead får inte skapas i status %', NEW.status;
        END IF;
        INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
        VALUES (NEW.tenant_id, NEW.id, 'lead_created', NULL, NEW.status,
                COALESCE(current_setting('app.actor', true), 'system'),
                jsonb_build_object('source', NEW.source, 'channel', NEW.channel,
                                   'ad_id', NEW.ad_id, 'language', NEW.language));
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT ce_valid_transition(OLD.status, NEW.status) THEN
            RAISE EXCEPTION 'Otillåten statusövergång: % -> % (lead %)',
                OLD.status, NEW.status, OLD.id;
        END IF;

        -- Milstolpar stämplas här, aldrig av anroparen
        IF NEW.status IN ('contacted', 'in_conversation') AND NEW.first_contact_at IS NULL THEN
            NEW.first_contact_at := now();
        END IF;
        IF NEW.status = 'hot'        AND NEW.hot_at IS NULL        THEN NEW.hot_at := now();        END IF;
        IF NEW.status = 'handed_off' AND NEW.handed_off_at IS NULL THEN NEW.handed_off_at := now(); END IF;
        IF NEW.status = 'booked'     AND NEW.booked_at IS NULL     THEN NEW.booked_at := now();     END IF;
        IF NEW.status = 'paid'       AND NEW.paid_at IS NULL       THEN NEW.paid_at := now();       END IF;
        IF NEW.status = 'opted_out'  AND NEW.opted_out_at IS NULL  THEN NEW.opted_out_at := now();  END IF;

        INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
        VALUES (NEW.tenant_id, NEW.id, 'status_changed', OLD.status, NEW.status,
                COALESCE(current_setting('app.actor', true), 'system'),
                jsonb_build_object('group_size', NEW.group_size,
                                   'hot_reasons', to_jsonb(NEW.hot_reasons)));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_leads_status ON ce_leads;
CREATE TRIGGER trg_ce_leads_status
    BEFORE INSERT OR UPDATE ON ce_leads
    FOR EACH ROW EXECUTE FUNCTION ce_leads_status_guard();

-- ----------------------------------------------------------------------------
-- Human takeover loggas också (CE-41)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_conv_human_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.human_active IS DISTINCT FROM OLD.human_active THEN
        IF NEW.human_active THEN
            NEW.human_active_since := now();
            NEW.next_followup_at := NULL;   -- schemalagda utskick dödas direkt
        ELSE
            NEW.human_active_since := NULL;
        END IF;
        INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
        VALUES (NEW.tenant_id, NEW.lead_id,
                CASE WHEN NEW.human_active THEN 'human_takeover' ELSE 'human_released' END,
                COALESCE(current_setting('app.actor', true), 'system'),
                jsonb_build_object('conversation_id', NEW.id));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_conv_human ON ce_conversations;
CREATE TRIGGER trg_ce_conv_human
    BEFORE UPDATE ON ce_conversations
    FOR EACH ROW EXECUTE FUNCTION ce_conv_human_guard();

-- ----------------------------------------------------------------------------
-- FÖNSTERUNDERHÅLL
-- 24h service window: nollställs av varje INKOMMANDE meddelande.
-- 72h free entry point: startar när VÅRT FÖRSTA svar LEVERERAS på en
-- CTWA-konversation. Nollställs aldrig av kundsvar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_touch_windows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_entry_point text;
    v_free_open   timestamptz;
BEGIN
    IF NEW.direction = 'inbound' THEN
        UPDATE ce_conversations
           SET last_inbound_at = NEW.created_at,
               service_window_expires_at = NEW.created_at + interval '24 hours'
         WHERE id = NEW.conversation_id;
        RETURN NEW;
    END IF;

    -- outbound: räknas först när det faktiskt gått iväg
    IF NEW.status IN ('sent', 'delivered', 'read') THEN
        SELECT entry_point, free_entry_opened_at
          INTO v_entry_point, v_free_open
          FROM ce_conversations WHERE id = NEW.conversation_id;

        UPDATE ce_conversations
           SET last_outbound_at = COALESCE(NEW.delivered_at, NEW.created_at),
               free_entry_opened_at = CASE
                   WHEN v_entry_point = 'ctwa' AND v_free_open IS NULL
                   THEN COALESCE(NEW.delivered_at, NEW.created_at)
                   ELSE free_entry_opened_at END,
               free_entry_expires_at = CASE
                   WHEN v_entry_point = 'ctwa' AND v_free_open IS NULL
                   THEN COALESCE(NEW.delivered_at, NEW.created_at) + interval '72 hours'
                   ELSE free_entry_expires_at END
         WHERE id = NEW.conversation_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_msg_windows ON ce_messages;
CREATE TRIGGER trg_ce_msg_windows
    AFTER INSERT OR UPDATE OF status ON ce_messages
    FOR EACH ROW EXECUTE FUNCTION ce_touch_windows();

-- ----------------------------------------------------------------------------
-- Utskicksgrind: vad får skickas just nu, och i vilket format?
-- Uppföljningsmotorn (CE-43) och agenten MÅSTE gå via denna.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_send_policy(p_conversation_id uuid)
RETURNS TABLE (
    can_send        boolean,
    reason          text,
    required_format text,     -- 'free_text' | 'template'
    is_free         boolean
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE c record;
BEGIN
    SELECT cv.*, l.status AS lead_status
      INTO c
      FROM ce_conversations cv
      JOIN ce_leads l ON l.id = cv.lead_id
     WHERE cv.id = p_conversation_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'conversation_not_found', NULL::text, false; RETURN;
    END IF;
    IF c.lead_status = 'opted_out' THEN
        RETURN QUERY SELECT false, 'opted_out', NULL::text, false; RETURN;
    END IF;
    IF c.human_active THEN
        RETURN QUERY SELECT false, 'human_active', NULL::text, false; RETURN;
    END IF;
    IF c.status <> 'open' THEN
        RETURN QUERY SELECT false, 'conversation_closed', NULL::text, false; RETURN;
    END IF;

    RETURN QUERY SELECT
        true,
        'ok'::text,
        CASE WHEN c.service_window_expires_at > now() THEN 'free_text' ELSE 'template' END,
        COALESCE(c.free_entry_expires_at > now(), false);
END;
$$;

COMMENT ON FUNCTION ce_send_policy(uuid) IS
    'Enda tillåtna vägen till ett utskick. Kollar opt-out, human_active, 24h-fönstret (format) och 72h free entry (kostnad).';
;
