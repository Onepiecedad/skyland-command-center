-- ============================================================================
-- CE-10 (del 2) — RLS & TENANT-ISOLERING
-- Skarpt läge: från och med nu ligger extern kunddata (PII) i basen.
--   anon           -> total spärr
--   authenticated  -> ser BARA sin egen tenants rader (claim: tenant_id)
--   service_role   -> bypassar RLS (backenden, bakom Bearer-token)
-- Idempotent.
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

        -- anon får aldrig röra kunddata
        EXECUTE format(
            'CREATE POLICY deny_all_anon_%1$s ON %1$I AS RESTRICTIVE TO anon USING (false)', t);

        -- authenticated ser bara sin egen tenant
        EXECUTE format($p$
            CREATE POLICY tenant_isolation_%1$s ON %1$I
                TO authenticated
                USING (tenant_id = current_tenant_id())
                WITH CHECK (tenant_id = current_tenant_id())
        $p$, t);
    END LOOP;
END;
$$;

-- tenants-tabellen: authenticated ser bara sin egen rad, anon inget
DROP POLICY IF EXISTS deny_all_anon_tenants ON tenants;
DROP POLICY IF EXISTS tenant_self_tenants ON tenants;
CREATE POLICY deny_all_anon_tenants ON tenants AS RESTRICTIVE TO anon USING (false);
CREATE POLICY tenant_self_tenants ON tenants
    FOR SELECT TO authenticated
    USING (id = current_tenant_id());

-- Vyn måste köra med anroparens rättigheter, annars läcker den förbi RLS
ALTER VIEW ce_booking_stats_anon SET (security_invoker = on);

-- ----------------------------------------------------------------------------
-- tenant_id på befintliga CRM-tabeller (additivt, backfillas till 'skyland').
-- Ger en väg framåt utan att röra befintligt beteende — kolumnerna är nullbara
-- och ingen kod läser dem än.
-- ----------------------------------------------------------------------------
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
;
