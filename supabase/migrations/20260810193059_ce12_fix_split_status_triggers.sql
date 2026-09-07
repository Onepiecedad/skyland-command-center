-- ============================================================================
-- CE-12 (fix) — dela statustriggern i BEFORE (validera + stämpla) och
-- AFTER (logga). Logging i BEFORE INSERT bröt FK:n mot ce_lead_events eftersom
-- lead-raden inte fanns än.
-- ============================================================================

CREATE OR REPLACE FUNCTION ce_leads_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('new', 'contacted', 'in_conversation') THEN
            RAISE EXCEPTION 'Nytt lead får inte skapas i status %', NEW.status;
        END IF;
        IF NEW.status IN ('contacted', 'in_conversation') AND NEW.first_contact_at IS NULL THEN
            NEW.first_contact_at := now();
        END IF;
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
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ce_leads_status_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
        VALUES (NEW.tenant_id, NEW.id, 'lead_created', NULL, NEW.status,
                COALESCE(current_setting('app.actor', true), 'system'),
                jsonb_build_object('source', NEW.source, 'channel', NEW.channel,
                                   'ad_id', NEW.ad_id, 'language', NEW.language));
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
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

DROP TRIGGER IF EXISTS trg_ce_leads_status_log ON ce_leads;
CREATE TRIGGER trg_ce_leads_status_log
    AFTER INSERT OR UPDATE ON ce_leads
    FOR EACH ROW EXECUTE FUNCTION ce_leads_status_log();

-- Samma fallgrop i human-takeover-triggern: flytta loggningen till AFTER.
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
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ce_conv_human_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.human_active IS DISTINCT FROM OLD.human_active THEN
        INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
        VALUES (NEW.tenant_id, NEW.lead_id,
                CASE WHEN NEW.human_active THEN 'human_takeover' ELSE 'human_released' END,
                COALESCE(current_setting('app.actor', true), 'system'),
                jsonb_build_object('conversation_id', NEW.id));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_conv_human_log ON ce_conversations;
CREATE TRIGGER trg_ce_conv_human_log
    AFTER UPDATE ON ce_conversations
    FOR EACH ROW EXECUTE FUNCTION ce_conv_human_log();
;
