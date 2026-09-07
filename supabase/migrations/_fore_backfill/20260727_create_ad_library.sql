-- ad_library: Meta Ad Library-spaning (ad-intel-skillen skriver, Alex läser).
-- Körtid (days_running) är lönsamhetsproxyn — Ad Library visar aldrig ROAS/CTR/spend.
-- Upsert på ad_archive_id: en rad per annons, uppdateras vid varje ny scrape.

create table if not exists public.ad_library (
  id                  uuid primary key default gen_random_uuid(),

  -- Identitet
  ad_archive_id       text not null unique,        -- Metas arkiv-ID, dedup-nyckel
  page_name           text not null,               -- annonsörens sidnamn
  page_id             text,
  advertiser_norm     text,                        -- normaliserat namn för matchning mot CRM-kort

  -- Klassificering (sätts av scrape-körningen)
  vertical            text not null default 'tattoo',  -- tattoo | beauty | other
  geo_scope           text not null,               -- körningens scope-etikett: 'se' | 'nordic' | 'intl' | ...
  countries           text[] default '{}',         -- länder körningen sökte i
  search_term         text,                        -- söktermen som hittade annonsen

  -- Innehåll
  ad_text             text,
  cta_type            text,
  media_type          text,                        -- image | video | carousel | unknown
  creative_urls       jsonb not null default '[]',
  landing_url         text,
  publisher_platforms text[] default '{}',

  -- Körtid = vinnarproxyn
  start_date          date,
  end_date            date,
  is_active           boolean,
  days_running        integer,                     -- beräknad vid senaste scrape

  -- Bokföring
  first_scraped_at    timestamptz not null default now(),
  last_scraped_at     timestamptz not null default now(),
  raw                 jsonb                        -- trimmad snapshot för omanalys utan ny scrape
);

comment on table public.ad_library is
  'Meta Ad Library-scrapes (ad-intel). Körtid är enda lönsamhetssignalen — Ad Library exponerar ingen prestanda.';

-- Rankningsfrågan: "långkörare per vertikal"
create index if not exists ad_library_winners_idx
  on public.ad_library (vertical, is_active, days_running desc);

-- Matchning mot CRM / per annonsör
create index if not exists ad_library_advertiser_idx
  on public.ad_library (advertiser_norm);
create index if not exists ad_library_page_name_idx
  on public.ad_library (page_name);

-- Endast service-rollen (skillens skrivväg + backend) rör tabellen.
-- Inga policies = anon/authenticated ser ingenting.
alter table public.ad_library enable row level security;
