-- ce_jobs hade ingen klocka: kön kördes bara vid GET ?run_jobs=1 eller efter nästa inkommande
-- webhook, så ett utskick i lugn period låg tills nästa gäst hörde av sig. Nu tickar pg_cron var
-- femte minut och anropar båda funktionerna. Anropen är idempotenta (claim på status=pending).
-- Applicerad i prod 8 sep 2026 (apply_migration "ce_jobs_cron").
--
-- Kontroll:  select jobid, jobname, schedule, active from cron.job;
--            select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- Stäng av:  select cron.unschedule('ce_agent_run_jobs'); select cron.unschedule('ce_leads_run_jobs');

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
