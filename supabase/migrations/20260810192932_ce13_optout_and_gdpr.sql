-- ============================================================================
-- CE-13 — OPT-OUT + GDPR-radering
-- Frasdetekteringen på fyra språk ligger här (DB-sanningen); agenten och
-- webhooken anropar ce_is_opt_out_phrase() så samma regel gäller överallt.
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Opt-out-fraser: SV / EN / DE / PL.
-- Matchar hela meddelandet (normaliserat) eller meddelande som ENBART består
-- av frasen + skiljetecken — inte "stop asking me about the price" mitt i text.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_is_opt_out_phrase(p_body text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
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

-- ----------------------------------------------------------------------------
-- ce_opt_out — dödar all automation maskinellt, inte per konvention
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_opt_out(p_lead_id uuid, p_reason text DEFAULT 'user_request')
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ce_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Okänt lead %', p_lead_id;
    END IF;

    UPDATE ce_leads
       SET status = 'opted_out',
           opted_out_at = COALESCE(opted_out_at, now()),
           opt_out_reason = p_reason
     WHERE id = p_lead_id AND status <> 'opted_out';

    -- Automationen dödas i samma svep: inga schemalagda utskick kan överleva
    UPDATE ce_conversations
       SET status = 'closed',
           next_followup_at = NULL,
           human_active = false
     WHERE lead_id = p_lead_id;

    INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
    VALUES (v_tenant, p_lead_id, 'opt_out',
            COALESCE(current_setting('app.actor', true), 'system'),
            jsonb_build_object('reason', p_reason));
END;
$$;

-- Automatisk opt-out när kunden skriver frasen — ingen agent behöver tolka rätt
CREATE OR REPLACE FUNCTION ce_detect_opt_out()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.direction = 'inbound' AND ce_is_opt_out_phrase(NEW.body) THEN
        PERFORM ce_opt_out(
            (SELECT lead_id FROM ce_conversations WHERE id = NEW.conversation_id),
            'inbound_phrase'
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_msg_optout ON ce_messages;
CREATE TRIGGER trg_ce_msg_optout
    AFTER INSERT ON ce_messages
    FOR EACH ROW EXECUTE FUNCTION ce_detect_opt_out();

-- ----------------------------------------------------------------------------
-- GDPR-radering: persondata bort, bokningsstatistik kvar (anonymiserad).
-- Provisionsunderlaget överlever raderingen — beloppen är Skylands fordran,
-- inte den registrerades personuppgifter.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ce_erase_lead(p_lead_id uuid, p_reason text DEFAULT 'gdpr_request')
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ce_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Okänt lead %', p_lead_id;
    END IF;

    UPDATE ce_messages
       SET body = NULL,
           raw = '{}'::jsonb,
           error = NULL
     WHERE lead_id = p_lead_id;

    UPDATE ce_customers
       SET name = NULL, email = NULL, phone = NULL, notes = NULL,
           custom = '{}'::jsonb, erased_at = now()
     WHERE lead_id = p_lead_id;

    UPDATE ce_leads
       SET name = NULL, phone = NULL, wa_id = NULL, email = NULL,
           notes = NULL, budget_signal = NULL,
           custom = '{}'::jsonb, dedupe_key = NULL,
           erased_at = now()
     WHERE id = p_lead_id;

    -- Bokningar behålls: belopp, datum, gruppstorlek, attribution. Ingen PII.
    UPDATE ce_bookings
       SET title = NULL, notes = NULL
     WHERE lead_id = p_lead_id;

    INSERT INTO ce_lead_events (tenant_id, lead_id, event_type, actor, payload)
    VALUES (v_tenant, p_lead_id, 'erased',
            COALESCE(current_setting('app.actor', true), 'system'),
            jsonb_build_object('reason', p_reason));
END;
$$;

-- ----------------------------------------------------------------------------
-- Anonymiserad bokningsstatistik — överlever radering
-- ----------------------------------------------------------------------------
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
;
