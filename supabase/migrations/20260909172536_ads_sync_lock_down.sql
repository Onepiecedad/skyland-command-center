-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Säkerhetsgranskningen fångade två saker som infördes samma dag.
--
-- 1. ads_sync_daglig() är SECURITY DEFINER och låg exponerad på
--    /rest/v1/rpc/ads_sync_daglig för både anon och authenticated. Den läser
--    en nyckel ur vault och triggar hämtning mot Meta plus skrivningar i
--    ad_performance. Ingen utomstående ska kunna starta den. Bara cron, som
--    kör som postgres, behöver den.
revoke all on function public.ads_sync_daglig() from public, anon, authenticated;

-- 2. Vyerna ad_health och ad_funnel skapades som SECURITY DEFINER (Postgres
--    standard), vilket kringgår RLS på ad_performance och ce_leads. Med
--    security_invoker gäller den anropandes rättigheter i stället, alltså
--    samma spärr som på bastabellerna: bara service-rollen läser.
alter view public.ad_health  set (security_invoker = true);
alter view public.ad_funnel  set (security_invoker = true);
