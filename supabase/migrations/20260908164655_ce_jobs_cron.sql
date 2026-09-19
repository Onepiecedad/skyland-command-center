-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- ce_jobs hade ingen klocka: kön kördes bara vid GET ?run_jobs=1 eller efter nästa inkommande
-- webhook, så ett utskick i lugn period låg tills nästa gäst hörde av sig. Nu tickar pg_cron var
-- femte minut och anropar båda funktionerna. Anropen är idempotenta (claim på status=pending).
-- 8 sep 2026.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobname) from cron.job where jobname in ('ce_agent_run_jobs','ce_leads_run_jobs');

select cron.schedule(
  'ce_agent_run_jobs',
  '*/5 * * * *',
  $$ select net.http_get(
       url := 'https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/ce-agent-webhook?run_jobs=1',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       timeout_milliseconds := 20000
     ); $$
);

select cron.schedule(
  'ce_leads_run_jobs',
  '2-59/5 * * * *',
  $$ select net.http_get(
       url := 'https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/meta-leads-webhook?run_jobs=1',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       timeout_milliseconds := 20000
     ); $$
);
