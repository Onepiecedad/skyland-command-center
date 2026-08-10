-- ============================================================================
-- SEC-01 ROLLBACK — stäng av RLS igen på legacy-tabellerna
--
-- Kör BARA om något i drift visar sig läsa basen med anon- eller
-- authenticated-nyckel och slutat fungera efter 2026-08-10.
-- Backenden kör som service_role och kan per definition inte drabbas.
--
-- Diagnos först — vad läser med fel nyckel?
--   Supabase Dashboard -> Logs -> API/Postgres, filtrera på 401/403 eller
--   tomma svar. Är det frontendens realtime (VITE_SUPABASE_ANON_KEY) är rätt
--   åtgärd att ta bort den kopplingen, inte att öppna basen igen.
--
-- OBS: ce_-tabellerna rörs INTE av denna rollback. De innehåller extern
-- kunddata och ska aldrig ligga öppna.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customers','contacts','opportunities','pipelines','bookings',
        'activities','tasks','messages','agent_configs','task_runs','costs',
        'stages','deliverables','sequences','sequence_steps',
        'sequence_enrollments','sequence_step_runs','todos','studio_assets'
    ] LOOP
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END;
$$;

ALTER VIEW customer_status SET (security_invoker = off);

-- ad_library och events hade RLS på redan före SEC-01 — lämnas på.
-- Vill man släppa även dem:
--   ALTER TABLE ad_library DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE events     DISABLE ROW LEVEL SECURITY;

-- Partiell rollback av EN tabell i stället för allt:
--   ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
