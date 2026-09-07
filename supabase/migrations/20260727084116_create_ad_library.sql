-- ad_library: Meta Ad Library-spaning (ad-intel-skillen skriver, Alex läser).
-- Körtid (days_running) är lönsamhetsproxyn — Ad Library visar aldrig ROAS/CTR/spend.
-- Upsert på ad_archive_id: en rad per annons, uppdateras vid varje ny scrape.

create table if not exists public.ad_library (
  id                  uuid primary key default gen_random_uuid(),
  ad_archive_id       text not null unique,
  page_name           text not null,
  page_id             text,
  advertiser_norm     text,
  vertical            text not null default 'tattoo',
  geo_scope           text not null,
  countries           text[] default '{}',
  search_term         text,
  ad_text             text,
  cta_type            text,
  media_type          text,
  creative_urls       jsonb not null default '[]',
  landing_url         text,
  publisher_platforms text[] default '{}',
  start_date          date,
  end_date            date,
  is_active           boolean,
  days_running        integer,
  first_scraped_at    timestamptz not null default now(),
  last_scraped_at     timestamptz not null default now(),
  raw                 jsonb
);

comment on table public.ad_library is
  'Meta Ad Library-scrapes (ad-intel). Körtid är enda lönsamhetssignalen — Ad Library exponerar ingen prestanda.';

create index if not exists ad_library_winners_idx
  on public.ad_library (vertical, is_active, days_running desc);
create index if not exists ad_library_advertiser_idx
  on public.ad_library (advertiser_norm);
create index if not exists ad_library_page_name_idx
  on public.ad_library (page_name);

alter table public.ad_library enable row level security;;
