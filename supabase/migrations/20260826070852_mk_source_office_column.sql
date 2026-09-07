-- Vilket kontor objektet kommer från. Gör det möjligt att köra flera kontor i samma
-- tenant nu och dela upp dem i egna tenants senare med en UPDATE i stället för en ny scrape.
alter table public.mk_listings add column if not exists source_office text;
alter table public.mk_brokers  add column if not exists source_office text;

create index if not exists mk_listings_tenant_office_idx on public.mk_listings (tenant_id, source_office);

comment on column public.mk_listings.source_office is 'Vitec customerId för kontoret, t.ex. M16501. Sätts av mk-ingest.';

update public.mk_listings
   set source_office = 'M16501'
 where tenant_id = tenant_id_by_slug('husman-hagberg-molndal')
   and source_office is null;;
