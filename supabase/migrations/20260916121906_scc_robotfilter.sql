-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_robot boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.ar_robot(ua text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT ua IS NOT NULL AND btrim(ua) <> '' AND (
         btrim(ua) !~* '^mozilla/'
      OR ua ~* ('(?<!cu)bot\y|bot/|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|site24x7'
             || '|moto g power \(2022\)|edge/12\.246'
             || '|bingpreview|facebookexternalhit|meta-external|meta-webindexer'
             || '|google-inspectiontool|googleother|google-read-aloud|adsbot|mediapartners'
             || '|dataprovider|bitsight|ahrefs|semrush|mj12|petalbot|yandex|baidu|sogou'
             || '|bytespider|gptbot|claudebot|perplexity|ccbot|applebot|duckduck'
             || '|linkedinbot|twitterbot|slackbot|discordbot|telegrambot|whatsapp'
             || '|curl/|wget|python|axios|node-fetch|undici|go-http|java/|okhttp|httpclient|postman'))
$$;

UPDATE public.sessions s SET is_robot = true
WHERE NOT s.is_robot
  AND public.ar_robot(s.user_agent)
  AND NOT EXISTS (SELECT 1 FROM public.prospects p WHERE p.session_uuid = s.session_uuid)
  AND NOT EXISTS (SELECT 1 FROM public.voice_calls v WHERE v.session_uuid = s.session_uuid)
  AND NOT EXISTS (SELECT 1 FROM public.interactions i WHERE i.session_uuid = s.session_uuid);

CREATE INDEX IF NOT EXISTS idx_sessions_is_robot ON public.sessions (tenant_id) WHERE is_robot;

CREATE TABLE IF NOT EXISTS public.events_robot_arkiv (LIKE public.events INCLUDING ALL);
ALTER TABLE public.events_robot_arkiv ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events_robot_arkiv' AND policyname = 'anon_spärr') THEN
    CREATE POLICY anon_spärr ON public.events_robot_arkiv AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;

WITH flyttade AS (
  DELETE FROM public.events e
  USING public.sessions s
  WHERE s.session_uuid = e.session_uuid AND s.is_robot
  RETURNING e.*
)
INSERT INTO public.events_robot_arkiv SELECT * FROM flyttade ON CONFLICT DO NOTHING;
