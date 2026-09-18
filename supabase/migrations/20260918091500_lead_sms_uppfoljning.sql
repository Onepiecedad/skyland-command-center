-- Automatisk SMS-uppföljning på nya leads.
--
-- Affärsmodellen vi kör efter säger att leadet ska kontaktas inom 5-10 minuter
-- efter formuläret. Ett lead som ligger över natten är i praktiken förlorat.
-- Hittills har lead-intake bara larmat ägaren; nu skickar den till leadet.
--
-- Kön ligger i databasen i stället för i funktionen, eftersom en edge function
-- inte kan sova i fem minuter. pg_cron knackar varje minut, funktionen plockar
-- det som förfallit. Samma mönster som ce_jobs, men med en send_at.

create table if not exists lead_sms_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lead_id     uuid not null references ce_leads(id) on delete cascade,
  page_id     text not null,
  steg        int  not null default 1,
  send_at     timestamptz not null,
  to_phone    text not null,
  body        text not null,
  status      text not null default 'pending'
              check (status in ('pending','sending','sent','cancelled','failed')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- Plockordningen för schemaläggaren.
create index if not exists lead_sms_outbox_kolla
  on lead_sms_outbox (status, send_at);

-- Ett steg per lead, en gång. Skyddar mot dubbelutskick om något körs om.
create unique index if not exists lead_sms_outbox_unik
  on lead_sms_outbox (lead_id, steg);

-- Hitta leadet när svaret kommer in från ett okänt nummer.
create index if not exists lead_sms_outbox_telefon
  on lead_sms_outbox (to_phone);

alter table lead_sms_outbox enable row level security;

-- Sekvensen för Vinnie. Texterna bor i routingraden, inte i koden, så att nästa
-- kund får sina egna utan en ny deploy. Tystnad 21-08 så att ingen väcks.
update meta_lead_routes
   set config = jsonb_set(config, '{sms}', $json$
{
  "active": true,
  "from": "+46766864314",
  "quiet": { "from": 21, "to": 8 },
  "steps": [
    { "delay_min": 5,
      "text": "Hej {fornamn}! Joakim här, jag hjälper Vinnie med bokningarna. Han tar bara ett fåtal heldagar i månaden och närmaste datumen går först. När kan jag ringa dig?" },
    { "delay_min": 240,
      "text": "Hej igen {fornamn}! Heldagarna bokas i tur och ordning och de tidigaste datumen är alltid först borta. Svara här när du har en stund, så tar vi det. /Joakim" },
    { "delay_min": 1440,
      "text": "Hej {fornamn}, sista gången jag hör av mig. Vill du fortfarande ha en heldag hos Vinnie i höst så svara här eller ring 0735643495. /Joakim" }
  ]
}
$json$::jsonb, true)
 where page_id = '1021795327677822';

-- Schemaläggaren. Varje minut, förskjuten från de andra jobben som ligger på
-- var femte. Funktionen claimar raderna innan den skickar, så en dubbelknackning
-- kan inte skicka samma SMS två gånger.
select cron.unschedule('lead_intake_sms') where exists (
  select 1 from cron.job where jobname = 'lead_intake_sms'
);

select cron.schedule(
  'lead_intake_sms',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/lead-intake?run_sms=1',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);
