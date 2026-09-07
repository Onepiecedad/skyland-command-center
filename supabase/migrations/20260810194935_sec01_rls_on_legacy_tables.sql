-- ============================================================================
-- SEC-01 — RLS PÅ DE 19 LEGACY-TABELLERNA
--
-- Bakgrund: RLS har varit avstängt sedan projektstart. Med anon-nyckeln var
-- varje rad läs- och skrivbar. Det var acceptabelt så länge SCC var internt,
-- men Cold Experience-piloten för in extern kunddata (PII) i samma bas.
--
-- Blast radius verifierad före applicering:
--   * backend/src/services/supabase.ts  -> SUPABASE_SERVICE_ROLE_KEY (bypassar RLS)
--   * backend/.env                      -> ingen SUPABASE_ANON_KEY satt
--   * frontend/.env.production          -> ingen VITE_SUPABASE_ANON_KEY (realtime av i prod)
--   * publication supabase_realtime     -> NOLL tabeller (postgres_changes streamar inget)
--   * skills (ad_intel.py m.fl.)        -> SUPABASE_SERVICE_ROLE_KEY
--   * n8n Cloud                         -> annat projekt (cskhydqmazohmrralglh) + backend-intake
--   * edge function migration-import    -> verify_jwt, kör med egen nyckel
--
-- Mönster (samma som sessions/prospects/interactions/voice_calls sedan tidigare):
--   anon          -> total spärr
--   authenticated -> tenant-isolering där tenant_id finns, annars total spärr
--   service_role  -> bypassar RLS (backenden, bakom Bearer-token)
--
-- ROLLBACK: se database/migrations/sec01_rollback.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabeller MED tenant_id -> tenant-isolering för authenticated
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['customers','contacts','opportunities','pipelines','bookings'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
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

-- ----------------------------------------------------------------------------
-- 2. Tabeller UTAN tenant_id -> total spärr för både anon och authenticated.
--    Endast service_role (backenden) kommer åt dem. Tenant-lager läggs på när
--    respektive tabell fått tenant_id.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'activities','tasks','messages','agent_configs','task_runs','costs',
        'stages','deliverables','sequences','sequence_steps',
        'sequence_enrollments','sequence_step_runs','todos','studio_assets',
        -- redan RLS-aktiverade men helt utan policies: gör spärren uttrycklig
        'ad_library','events'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS deny_all_anon_%1$s ON %1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS deny_all_authenticated_%1$s ON %1$I', t);
        EXECUTE format(
            'CREATE POLICY deny_all_anon_%1$s ON %1$I AS RESTRICTIVE TO anon USING (false)', t);
        EXECUTE format(
            'CREATE POLICY deny_all_authenticated_%1$s ON %1$I AS RESTRICTIVE TO authenticated USING (false)', t);
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. customer_status var SECURITY DEFINER -> körde med skaparens rättigheter
--    och gick därmed förbi RLS på customers/activities/tasks/contacts.
--    Backenden kör som service_role och påverkas inte.
-- ----------------------------------------------------------------------------
ALTER VIEW customer_status SET (security_invoker = on);

-- ----------------------------------------------------------------------------
-- 4. Mutabel search_path på kvarvarande funktion
-- ----------------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'match_knowledge_base'
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
    END LOOP;
END;
$$;
;
