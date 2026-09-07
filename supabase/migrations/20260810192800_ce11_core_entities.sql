-- ============================================================================
-- CE-11 — KÄRNENTITETER för Cold Experience-leadsystemet
-- ce_leads, ce_conversations, ce_messages, ce_customers, ce_bookings,
-- ce_payments. Fulla entiteter från dag ett — nivå 2 ska bli UI-bygge,
-- inte migrering. Tenant-generiskt (tenant_id överallt). Idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- ce_leads — allt som kommer in från annons/konversation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ce_leads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

    -- Identitet
    name            text,
    phone           text,                 -- E.164
    wa_id           text,                 -- WhatsApp-id (kan skilja från phone)
    email           text,
    country         text,                 -- ISO-3166 alpha-2
    language        text NOT NULL DEFAULT 'en',   -- en | sv | de | pl

    -- Ursprung / attribution
    source          text NOT NULL DEFAULT 'ctwa'
                    CHECK (source IN ('ctwa', 'lead_ads', 'messenger', 'manual', 'organic')),
    channel         text NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp', 'messenger', 'sms', 'email', 'other')),
    ad_referral     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ad_id, headline, ctwa_clid, source_url
    ad_id           text,
    campaign_id     text,

    -- Kvalificering (matchar produkten: 5-7 dagar, grupper om 4-8)
    group_size      integer CHECK (group_size IS NULL OR group_size > 0),
    desired_from    date,
    desired_to      date,
    budget_signal   text,
    qualification   jsonb NOT NULL DEFAULT '{}'::jsonb,
    hot_reasons     text[] NOT NULL DEFAULT '{}',

    -- Statusmaskin (CE-12)
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN (
                        'new', 'contacted', 'in_conversation', 'qualifying',
                        'hot', 'handed_off', 'booked', 'paid',
                        'cold', 'nurture', 'opted_out'
                    )),

    -- Milstolpar (stämplas automatiskt av statustriggern — faktureringsunderlag)
    first_contact_at timestamptz,
    hot_at           timestamptz,
    handed_off_at    timestamptz,
    booked_at        timestamptz,
    paid_at          timestamptz,
    opted_out_at     timestamptz,
    opt_out_reason   text,

    -- GDPR
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

-- ----------------------------------------------------------------------------
-- ce_conversations — en tråd per lead och kanal, med BÅDA fönstren
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ce_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    lead_id         uuid NOT NULL REFERENCES ce_leads(id) ON DELETE CASCADE,

    channel         text NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp', 'messenger', 'sms', 'email', 'other')),
    external_id     text,                 -- WABA-konversations-id / Messenger thread-id
    entry_point     text NOT NULL DEFAULT 'ctwa'
                    CHECK (entry_point IN ('ctwa', 'lead_ads', 'messenger', 'organic', 'manual')),

    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed')),

    -- Human takeover (CE-41): kollas före VARJE utskick
    human_active        boolean NOT NULL DEFAULT false,
    human_active_since  timestamptz,

    -- De två fönstren (se kostnadsnotisen i backloggen)
    -- service_window: 24h från kundens senaste meddelande — styr FORMAT
    -- free_entry:     72h från VÅRT första levererade svar (CTWA) — styr KOSTNAD
    last_inbound_at             timestamptz,
    last_outbound_at            timestamptz,
    service_window_expires_at   timestamptz,
    free_entry_expires_at       timestamptz,
    free_entry_opened_at        timestamptz,

    -- Uppföljningsmotorn (CE-43)
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

-- ----------------------------------------------------------------------------
-- ce_messages — varje meddelande, med kostnads- och kategorimärkning
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- ce_customers — lead som blivit kund
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- ce_bookings — medvetet spartansk logg (CE-50), men provisionsbärande
-- ----------------------------------------------------------------------------
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

    -- Attribution: vilken annons ledde hit (kopieras från leadet vid skapande)
    attribution     jsonb NOT NULL DEFAULT '{}'::jsonb,
    source          text NOT NULL DEFAULT 'manual',
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_book_tenant ON ce_bookings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_book_lead ON ce_bookings(lead_id);
CREATE INDEX IF NOT EXISTS idx_ce_book_paid ON ce_bookings(tenant_id, paid_at) WHERE paid;

-- ----------------------------------------------------------------------------
-- ce_payments — betalningar mot bokning (faktureringsunderlaget)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- updated_at-triggers
-- ----------------------------------------------------------------------------
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
;
