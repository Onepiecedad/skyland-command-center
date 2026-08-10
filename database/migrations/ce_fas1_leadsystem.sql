-- ============================================================================
-- CE-10..CE-13 — FAS 1: DATAMODELL & TENANT-SEPARATION (Cold Experience)
--
-- Kund:      Cold Experience Lapland AB (org.nr 559558-0233), pilot för
--            upplevelse-vertikalen. Första EXTERNA tenanten i SCC.
-- Affär:     10 % provision på det kunden betalar inkl. moms, faktureras
--            månadsvis på BETALDA bokningar. Noll upfront.
-- Ägande:    Datan är tenantens (exporterbar när som helst). Plattformen är
--            Skylands. Därav tenant_id överallt och strikt RLS-isolering.
--
-- Innehåll:
--   1. CE-10  tenants + hjälpfunktioner
--   2. CE-11  kärnentiteter (leads, conversations, messages, customers,
--             bookings, payments)
--   3. CE-12  statusmaskin, append-only audit trail, fönsterunderhåll
--             (24h service window / 72h free entry point), utskicksgrind
--   4. CE-13  opt-out (SV/EN/DE/PL) + GDPR-radering
--   5. CE-10  RLS & tenant-isolering + tenant_id på befintliga CRM-tabeller
--
-- Applicerad i prod 2026-08-10. Idempotent — kan köras om.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. CE-10 — TENANTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text UNIQUE NOT NULL,
    name        text NOT NULL,
    org_no      text,
    vertical    text,                       -- 'experience' | 'tattoo' | 'beauty' | 'internal'
    status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'offboarded')),
    commercials jsonb NOT NULL DEFAULT '{}'::jsonb,   -- provision, valuta, kostnadsdelning
    config      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenants IS
    'Tenant-registret för SCC. Data tillhör tenanten; plattformen gör det inte.';

INSERT INTO tenants (slug, name, vertical, commercials, config)
VALUES
  ('skyland', 'Skyland AI Solutions (intern)', 'internal',
   '{}'::jsonb,
   '{"note": "Joakims egen drift — tattoo- och beauty-pipelines"}'::jsonb),
  ('cold-experience', 'Cold Experience Lapland AB', 'experience',
   jsonb_build_object(
     'commission_rate', 0.10,
     'commission_basis', 'gross_incl_vat',
     'billing', 'monthly_on_paid_bookings',
     'upfront', 0,
     'ad_spend_paid_by', 'tenant',
     'platform_ownership', 'skyland'
   ),
   jsonb_build_object(
     'org_no', '559558-0233',
     'meta_business_id', '698578172315817',
     'meta_page_id', '121304091066868',
     'languages', jsonb_build_array('en', 'sv', 'de', 'pl'),
     'season_months', jsonb_build_array(1, 2, 3, 4),
     'group_size_core', jsonb_build_array(4, 8)
   ))
ON CONFLICT (slug) DO NOTHING;

UPDATE tenants SET org_no = '559558-0233'
 WHERE slug = 'cold-experience' AND org_no IS DISTINCT FROM '559558-0233';

-- Aktuell tenant ur JWT-claim eller session-GUC. Används av RLS-policies.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', ''),
        NULLIF(current_setting('app.tenant_id', true), '')
    )::uuid
$$;

CREATE OR REPLACE FUNCTION tenant_id_by_slug(p_slug text)
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM tenants WHERE slug = p_slug
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. CE-11 — KÄRNENTITETER
-- Fulla entiteter från dag ett. Nivå 2 ska bli UI-bygge, inte migrering.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ce_leads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

    name            text,
    phone           text,                 -- E.164
    wa_id           text,                 -- WhatsApp-id (kan skilja från phone)
    email           text,
    country         text,                 -- ISO-3166 alpha-2
    language        text NOT NULL DEFAULT 'en',   -- en | sv | de | pl

    source          text NOT NULL DEFAULT 'ctwa'
                    CHECK (source IN ('ctwa', 'lead_ads', 'messenger', 'manual', 'organic')),
    channel         text NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp', 'messenger', 'sms', 'email', 'other')),
    ad_referral     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ad_id, headline, ctwa_clid, source_url
    ad_id           text,
    campaign_id     text,

    -- Kvalificering: produkten är 5–7 dagar all-inclusive för grupper om 4–8
    group_size      integer CHECK (group_size IS NULL OR group_size > 0),
    desired_from    date,
    desired_to      date,
    budget_signal   text,
    qualification   jsonb NOT NULL DEFAULT '{}'::jsonb,
    hot_reasons     text[] NOT NULL DEFAULT '{}',

    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN (
                        'new', 'contacted', 'in_conversation', 'qualifying',
                        'hot', 'handed_off', 'booked', 'paid',
                        'cold', 'nurture', 'opted_out'
                    )),

    -- Milstolpar — stämplas av triggern, aldrig av anroparen
    first_contact_at timestamptz,
    hot_at           timestamptz,
    handed_off_at    timestamptz,
    booked_at        timestamptz,
    paid_at          timestamptz,
    opted_out_at     timestamptz,
    opt_out_reason   text,
    erased_at        timestamptz,

    notes           text,
    custom          jsonb NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ce_leads IS
    'Leads per tenant. Datan tillhör tenanten och ska vara exporterbar när som helst.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_leads_dedupe
    ON ce_leads(tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_leads_phone
    ON ce_leads(tenant_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_leads_tenant_status ON ce_leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ce_leads_created ON ce_leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_leads_hot ON ce_leads(tenant_id, hot_at DESC) WHERE hot_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_leads_paid ON ce_leads(tenant_id, paid_at DESC) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_leads_email ON ce_leads(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_leads_ad ON ce_leads(tenant_id, ad_id) WHERE ad_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ce_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id         uuid NOT NULL REFERENCES ce_leads(id) ON DELETE CASCADE,

    channel         text NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp', 'messenger', 'sms', 'email', 'other')),
    external_id     text,
    entry_point     text NOT NULL DEFAULT 'ctwa'
                    CHECK (entry_point IN ('ctwa', 'lead_ads', 'messenger', 'organic', 'manual')),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),

    -- Human takeover (CE-41): kollas före VARJE utskick
    human_active        boolean NOT NULL DEFAULT false,
    human_active_since  timestamptz,

    -- De två fönstren:
    --   service_window: 24h från kundens senaste meddelande — styr FORMAT
    --   free_entry:     72h från VÅRT första levererade svar (CTWA) — styr KOSTNAD
    last_inbound_at             timestamptz,
    last_outbound_at            timestamptz,
    service_window_expires_at   timestamptz,
    free_entry_expires_at       timestamptz,
    free_entry_opened_at        timestamptz,

    followup_step       integer NOT NULL DEFAULT 0,
    next_followup_at    timestamptz,
    language            text,

    meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_conv_external
    ON ce_conversations(tenant_id, channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_conv_lead ON ce_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_ce_conv_tenant_status ON ce_conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ce_conv_human ON ce_conversations(tenant_id) WHERE human_active;
CREATE INDEX IF NOT EXISTS idx_ce_conv_next_followup
    ON ce_conversations(next_followup_at)
    WHERE next_followup_at IS NOT NULL AND status = 'open' AND NOT human_active;
CREATE INDEX IF NOT EXISTS idx_ce_conv_free_entry ON ce_conversations(free_entry_expires_at);

CREATE TABLE IF NOT EXISTS ce_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL REFERENCES ce_conversations(id) ON DELETE CASCADE,
    lead_id         uuid REFERENCES ce_leads(id) ON DELETE CASCADE,

    direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender          text NOT NULL DEFAULT 'agent'
                    CHECK (sender IN ('lead', 'agent', 'human', 'system')),
    channel         text NOT NULL DEFAULT 'whatsapp',
    external_id     text,

    body            text,
    language        text,
    message_type    text NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text', 'template', 'image', 'video',
                                            'audio', 'document', 'location',
                                            'interactive', 'reaction', 'system')),
    template_name       text,
    template_category   text CHECK (template_category IS NULL OR template_category IN
                        ('marketing', 'utility', 'authentication', 'service')),

    -- Kostnadstak/larm (CE-44) räknar på dessa
    billable        boolean NOT NULL DEFAULT false,
    cost_amount     numeric(10,4),
    cost_currency   text DEFAULT 'SEK',
    free_entry      boolean NOT NULL DEFAULT false,  -- skickat inom 72h-fönstret

    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
    delivered_at    timestamptz,
    error           jsonb,
    raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_msg_external
    ON ce_messages(tenant_id, channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_msg_conv ON ce_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_msg_lead ON ce_messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_msg_billable
    ON ce_messages(tenant_id, created_at DESC) WHERE billable;

CREATE TABLE IF NOT EXISTS ce_customers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id     uuid REFERENCES ce_leads(id) ON DELETE SET NULL,
    name        text,
    email       text,
    phone       text,
    country     text,
    language    text,
    notes       text,
    custom      jsonb NOT NULL DEFAULT '{}'::jsonb,
    erased_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_cust_tenant ON ce_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ce_cust_lead ON ce_customers(lead_id);

-- Medvetet spartansk bokningslogg (CE-50), men provisionsbärande
CREATE TABLE IF NOT EXISTS ce_bookings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id         uuid REFERENCES ce_leads(id) ON DELETE SET NULL,
    customer_id     uuid REFERENCES ce_customers(id) ON DELETE SET NULL,

    title           text,
    package         text,
    group_size      integer,
    starts_on       date,
    ends_on         date,

    -- Provisionen räknas på det kunden betalar INKLUSIVE moms
    amount_gross    numeric(12,2) NOT NULL DEFAULT 0,
    currency        text NOT NULL DEFAULT 'SEK',
    commission_rate numeric(5,4) NOT NULL DEFAULT 0.10,
    commission_amount numeric(12,2)
                    GENERATED ALWAYS AS (round(amount_gross * commission_rate, 2)) STORED,

    status          text NOT NULL DEFAULT 'tentative'
                    CHECK (status IN ('tentative', 'confirmed', 'cancelled', 'completed')),
    paid            boolean NOT NULL DEFAULT false,
    paid_at         timestamptz,

    attribution     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- vilken annons ledde hit
    source          text NOT NULL DEFAULT 'manual',
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_book_tenant ON ce_bookings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_book_lead ON ce_bookings(lead_id);
CREATE INDEX IF NOT EXISTS idx_ce_book_paid ON ce_bookings(tenant_id, paid_at) WHERE paid;

CREATE TABLE IF NOT EXISTS ce_payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    booking_id  uuid NOT NULL REFERENCES ce_bookings(id) ON DELETE CASCADE,
    amount      numeric(12,2) NOT NULL,
    currency    text NOT NULL DEFAULT 'SEK',
    paid_at     timestamptz NOT NULL DEFAULT now(),
    method      text,
    reference   text,
    is_refund   boolean NOT NULL DEFAULT false,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_pay_booking ON ce_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_ce_pay_tenant_date ON ce_payments(tenant_id, paid_at DESC);

DROP TRIGGER IF EXISTS trg_ce_leads_updated_at ON ce_leads;
CREATE TRIGGER trg_ce_leads_updated_at BEFORE UPDATE ON ce_leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ce_conv_updated_at ON ce_conversations;
CREATE TRIGGER trg_ce_conv_updated_at BEFORE UPDATE ON ce_conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ce_msg_updated_at ON ce_messages;
CREATE TRIGGER trg_ce_msg_updated_at BEFORE UPDATE ON ce_messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ce_cust_updated_at ON ce_customers;
CREATE TRIGGER trg_ce_cust_updated_at BEFORE UPDATE ON ce_customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_ce_book_updated_at ON ce_bookings;
CREATE TRIGGER trg_ce_book_updated_at BEFORE UPDATE ON ce_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. CE-12 — STATUSMASKIN, AUDIT TRAIL, FÖNSTER, UTSKICKSGRIND
-- ============================================================================

CREATE TABLE IF NOT EXISTS ce_lead_events (
    id          bigserial PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id     uuid NOT NULL REFERENCES ce_leads(id) ON DELETE CASCADE,
    event_type  text NOT NULL,   -- lead_created | status_changed | human_takeover | opt_out | erased
    from_status text,
    to_status   text,
    actor       text NOT NULL DEFAULT 'system',
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_events_lead ON ce_lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ce_events_tenant_type
    ON ce_lead_events(tenant_id, event_type, created_at DESC);

COMMENT ON TABLE ce_lead_events IS
    'Append-only. Statusövergångar, handoff, opt-out. Underlag för provisionsavstämning.';

-- UPDATE alltid förbjudet. DELETE kräver uttrycklig session-flagga (annars gör
-- ON DELETE CASCADE från ce_leads hård radering omöjlig).
CREATE OR REPLACE FUNCTION ce_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_ce_events_no_update ON ce_lead_events;
CREATE TRIGGER trg_ce_events_no_update
    BEFORE UPDATE OR DELETE ON ce_lead_events
    FOR EACH ROW EXECUTE FUNCTION ce_events_append_only();

-- Tillåtna statusövergångar. Framåtflödet strikt; cold/nurture/opted_out nås
-- från vilket aktivt läge som helst; nurture/cold får återupptas.
CREATE OR REPLACE FUNCTION ce_valid_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_from = p_to THEN true
        WHEN p_from = 'opted_out' THEN false          -- slutgiltigt
        WHEN p_to IN ('cold', 'nurture', 'opted_out') THEN true
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

-- BEFORE: validera + stämpla milstolpar
CREATE OR REPLACE FUNCTION ce_leads_status_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
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
            RAISE EXCEPTION 'Otillåten statusövergång: % -> % (lead %)', OLD.status, NEW.status, OLD.id;
        END IF;
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

-- AFTER: logga (måste vara AFTER — i BEFORE INSERT finns lead-raden inte än
-- och FK:n mot ce_lead_events brister)
CREATE OR REPLACE FUNCTION ce_leads_status_log()
RETURNS trigger LANGUAGE plpgsql AS $$
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

-- Human takeover (CE-41)
CREATE OR REPLACE FUNCTION ce_conv_human_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
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
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_ce_conv_human ON ce_conversations;
CREATE TRIGGER trg_ce_conv_human
    BEFORE UPDATE ON ce_conversations FOR EACH ROW EXECUTE FUNCTION ce_conv_human_guard();
DROP TRIGGER IF EXISTS trg_ce_conv_human_log ON ce_conversations;
CREATE TRIGGER trg_ce_conv_human_log
    AFTER UPDATE ON ce_conversations FOR EACH ROW EXECUTE FUNCTION ce_conv_human_log();

-- FÖNSTERUNDERHÅLL
-- 24h service window nollställs av varje INKOMMANDE meddelande.
-- 72h free entry startar när VÅRT FÖRSTA svar LEVERERAS på en CTWA-konversation
-- och nollställs aldrig av kundsvar.
CREATE OR REPLACE FUNCTION ce_touch_windows()
RETURNS trigger LANGUAGE plpgsql AS $$
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

    IF NEW.status IN ('sent', 'delivered', 'read') THEN
        SELECT entry_point, free_entry_opened_at INTO v_entry_point, v_free_open
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

-- Utskicksgrind. Uppföljningsmotorn (CE-43) och agenten MÅSTE gå via denna.
CREATE OR REPLACE FUNCTION ce_send_policy(p_conversation_id uuid)
RETURNS TABLE (
    can_send        boolean,
    reason          text,
    required_format text,     -- 'free_text' | 'template'
    is_free         boolean
) LANGUAGE plpgsql STABLE AS $$
DECLARE c record;
BEGIN
    SELECT cv.*, l.status AS lead_status INTO c
      FROM ce_conversations cv JOIN ce_leads l ON l.id = cv.lead_id
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
        true, 'ok'::text,
        CASE WHEN c.service_window_expires_at > now() THEN 'free_text' ELSE 'template' END,
        COALESCE(c.free_entry_expires_at > now(), false);
END;
$$;

COMMENT ON FUNCTION ce_send_policy(uuid) IS
    'Enda tillåtna vägen till ett utskick. Kollar opt-out, human_active, 24h-fönstret (format) och 72h free entry (kostnad).';

-- ============================================================================
-- 4. CE-13 — OPT-OUT + GDPR
-- ============================================================================

-- Matchar hela meddelandet (normaliserat), inte fraser mitt i löpande text.
CREATE OR REPLACE FUNCTION ce_is_opt_out_phrase(p_body text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_body IS NULL THEN false
        ELSE trim(both from regexp_replace(lower(p_body), '[^\wåäöüßąćęłńóśźż ]', '', 'g')) = ANY (ARRAY[
            -- SV
            'stopp','sluta','avregistrera','avsluta','ta bort mig','sluta skicka','inte intresserad',
            -- EN
            'stop','unsubscribe','remove me','opt out','optout','cancel','not interested','leave me alone',
            -- DE
            'stopp','abmelden','abbestellen','loschen','nicht interessiert','keine nachrichten',
            -- PL
            'stop','wypisz','wypisz mnie','anuluj','nie zainteresowany','zrezygnuj'
        ])
    END
$$;

CREATE OR REPLACE FUNCTION ce_opt_out(p_lead_id uuid, p_reason text DEFAULT 'user_request')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ce_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Okänt lead %', p_lead_id; END IF;

    UPDATE ce_leads
       SET status = 'opted_out',
           opted_out_at = COALESCE(opted_out_at, now()),
           opt_out_reason = p_reason
     WHERE id = p_lead_id AND status <> 'opted_out';

    -- Automationen dödas i samma svep
    UPDATE ce_conversations
       SET status = 'closed', next_followup_at = NULL, human_active = false
     WHERE lead_id = p_lead_id;

    INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
    VALUES (v_tenant, p_lead_id, 'opt_out',
            COALESCE(current_setting('app.actor', true), 'system'),
            jsonb_build_object('reason', p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION ce_detect_opt_out()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.direction = 'inbound' AND ce_is_opt_out_phrase(NEW.body) THEN
        PERFORM ce_opt_out(
            (SELECT lead_id FROM ce_conversations WHERE id = NEW.conversation_id),
            'inbound_phrase');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_msg_optout ON ce_messages;
CREATE TRIGGER trg_ce_msg_optout
    AFTER INSERT ON ce_messages FOR EACH ROW EXECUTE FUNCTION ce_detect_opt_out();

-- GDPR: persondata bort, bokningsstatistik kvar (anonymiserad).
CREATE OR REPLACE FUNCTION ce_erase_lead(p_lead_id uuid, p_reason text DEFAULT 'gdpr_request')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ce_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Okänt lead %', p_lead_id; END IF;

    UPDATE ce_messages SET body = NULL, raw = '{}'::jsonb, error = NULL WHERE lead_id = p_lead_id;

    UPDATE ce_customers
       SET name = NULL, email = NULL, phone = NULL, notes = NULL,
           custom = '{}'::jsonb, erased_at = now()
     WHERE lead_id = p_lead_id;

    UPDATE ce_leads
       SET name = NULL, phone = NULL, wa_id = NULL, email = NULL,
           notes = NULL, budget_signal = NULL, custom = '{}'::jsonb,
           dedupe_key = NULL, erased_at = now()
     WHERE id = p_lead_id;

    -- Bokningar behålls: belopp, datum, gruppstorlek, attribution. Ingen PII.
    UPDATE ce_bookings SET title = NULL, notes = NULL WHERE lead_id = p_lead_id;

    INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
    VALUES (v_tenant, p_lead_id, 'erased',
            COALESCE(current_setting('app.actor', true), 'system'),
            jsonb_build_object('reason', p_reason));
END;
$$;

CREATE OR REPLACE VIEW ce_booking_stats_anon AS
SELECT
    b.tenant_id,
    date_trunc('month', b.paid_at)          AS month,
    count(*)                                AS bookings,
    sum(b.amount_gross)                     AS gross_incl_vat,
    sum(b.commission_amount)                AS commission,
    avg(b.group_size)::numeric(5,2)         AS avg_group_size,
    b.currency
FROM ce_bookings b
WHERE b.paid
GROUP BY b.tenant_id, date_trunc('month', b.paid_at), b.currency;

COMMENT ON VIEW ce_booking_stats_anon IS
    'Provisionsunderlag utan persondata. Överlever GDPR-radering (CE-13, CE-51).';

-- ============================================================================
-- 5. CE-10 — RLS & TENANT-ISOLERING
--   anon          -> total spärr
--   authenticated -> ser BARA sin egen tenants rader (claim: tenant_id)
--   service_role  -> bypassar RLS (backenden, bakom Bearer-token)
-- ============================================================================

ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_leads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_bookings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ce_lead_events   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'ce_leads','ce_conversations','ce_messages','ce_customers',
        'ce_bookings','ce_payments','ce_lead_events'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS deny_all_anon_%1$s ON %1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%1$s ON %1$I', t);
        EXECUTE format(
            'CREATE POLICY deny_all_anon_%1$s ON %1$I AS RESTRICTIVE TO anon USING (false)', t);
        EXECUTE format($p$
            CREATE POLICY tenant_isolation_%1$s ON %1$I
                TO authenticated
                USING (tenant_id = current_tenant_id())
                WITH CHECK (tenant_id = current_tenant_id())
        $p$, t);
    END LOOP;
END;
$$;

DROP POLICY IF EXISTS deny_all_anon_tenants ON tenants;
DROP POLICY IF EXISTS tenant_self_tenants ON tenants;
CREATE POLICY deny_all_anon_tenants ON tenants AS RESTRICTIVE TO anon USING (false);
CREATE POLICY tenant_self_tenants ON tenants
    FOR SELECT TO authenticated USING (id = current_tenant_id());

-- Vyn måste köra med anroparens rättigheter, annars läcker den förbi RLS
ALTER VIEW ce_booking_stats_anon SET (security_invoker = on);

-- tenant_id på befintliga CRM-tabeller (additivt, backfillas till 'skyland')
ALTER TABLE customers     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE contacts      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE pipelines     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE bookings      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

UPDATE customers     SET tenant_id = tenant_id_by_slug('skyland') WHERE tenant_id IS NULL;
UPDATE contacts      SET tenant_id = tenant_id_by_slug('skyland') WHERE tenant_id IS NULL;
UPDATE opportunities SET tenant_id = tenant_id_by_slug('skyland') WHERE tenant_id IS NULL;
UPDATE pipelines     SET tenant_id = tenant_id_by_slug('skyland') WHERE tenant_id IS NULL;
UPDATE bookings      SET tenant_id = tenant_id_by_slug('skyland') WHERE tenant_id IS NULL;

ALTER TABLE customers     ALTER COLUMN tenant_id SET DEFAULT tenant_id_by_slug('skyland');
ALTER TABLE contacts      ALTER COLUMN tenant_id SET DEFAULT tenant_id_by_slug('skyland');
ALTER TABLE opportunities ALTER COLUMN tenant_id SET DEFAULT tenant_id_by_slug('skyland');
ALTER TABLE pipelines     ALTER COLUMN tenant_id SET DEFAULT tenant_id_by_slug('skyland');
ALTER TABLE bookings      ALTER COLUMN tenant_id SET DEFAULT tenant_id_by_slug('skyland');

CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant ON opportunities(tenant_id);

-- ============================================================================
-- 6. HÄRDNING — lås search_path (current_tenant_id() styr RLS)
-- ============================================================================
ALTER FUNCTION current_tenant_id()               SET search_path = public, pg_temp;
ALTER FUNCTION tenant_id_by_slug(text)           SET search_path = public, pg_temp;
ALTER FUNCTION set_updated_at()                  SET search_path = public, pg_temp;
ALTER FUNCTION ce_valid_transition(text, text)   SET search_path = public, pg_temp;
ALTER FUNCTION ce_leads_status_guard()           SET search_path = public, pg_temp;
ALTER FUNCTION ce_leads_status_log()             SET search_path = public, pg_temp;
ALTER FUNCTION ce_conv_human_guard()             SET search_path = public, pg_temp;
ALTER FUNCTION ce_conv_human_log()               SET search_path = public, pg_temp;
ALTER FUNCTION ce_events_append_only()           SET search_path = public, pg_temp;
ALTER FUNCTION ce_touch_windows()                SET search_path = public, pg_temp;
ALTER FUNCTION ce_send_policy(uuid)              SET search_path = public, pg_temp;
ALTER FUNCTION ce_is_opt_out_phrase(text)        SET search_path = public, pg_temp;
ALTER FUNCTION ce_opt_out(uuid, text)            SET search_path = public, pg_temp;
ALTER FUNCTION ce_detect_opt_out()               SET search_path = public, pg_temp;
ALTER FUNCTION ce_erase_lead(uuid, text)         SET search_path = public, pg_temp;
