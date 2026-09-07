-- ============================================================================
-- CE-10 (del 1) — TENANTS
-- Tenant-registret. Cold Experience Lapland AB blir första EXTERNA tenant;
-- 'skyland' representerar Joakims egen interna drift (tattoo/beauty-pipelines).
-- Idempotent.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text UNIQUE NOT NULL,
    name        text NOT NULL,
    org_no      text,
    vertical    text,                       -- 'experience' | 'tattoo' | 'beauty' | 'internal'
    status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'offboarded')),
    -- Kommersiella villkor per tenant (provision, valuta, kostnadsdelning).
    commercials jsonb NOT NULL DEFAULT '{}'::jsonb,
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

-- ----------------------------------------------------------------------------
-- Hjälpfunktioner: aktuell tenant ur JWT-claim eller session-GUC.
-- Backenden kör som service_role (bypassar RLS). Dessa används av RLS-policies
-- för framtida per-tenant-nycklar och av tester.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', ''),
        NULLIF(current_setting('app.tenant_id', true), '')
    )::uuid
$$;

CREATE OR REPLACE FUNCTION tenant_id_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT id FROM tenants WHERE slug = p_slug
$$;

-- Generisk updated_at-trigger (återanvänds av alla ce_-tabeller).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
;
