-- Mäklarvertikalen (mk_*) — struktur per tenant, samma mönster som ce_*.

create table if not exists public.mk_brokers (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references public.tenants(id) on delete cascade,
    external_id  text,
    name         text not null,
    title        text,
    phone        text,
    email        text,
    photo_url    text,
    source_url   text,
    active       boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (tenant_id, external_id)
);
comment on table public.mk_brokers is 'Mäklare per byrå (tenant). Kontaktväg för handoff från röstagenten.';

create table if not exists public.mk_listings (
    id                 uuid primary key default gen_random_uuid(),
    tenant_id          uuid not null references public.tenants(id) on delete cascade,
    external_id        text not null,
    source             text not null default 'scrape',
    source_url         text,
    status             text not null default 'till_salu',
    object_type        text,
    tenure             text,
    headline           text,
    street_address     text,
    area               text,
    municipality       text,
    postal_code        text,
    county             text,
    price              numeric,
    price_currency     text not null default 'SEK',
    final_price        numeric,
    monthly_fee        numeric,
    operating_cost     numeric,
    rooms              numeric,
    living_area        numeric,
    supplementary_area numeric,
    plot_area          numeric,
    floor              text,
    elevator           boolean,
    balcony            boolean,
    build_year         integer,
    energy_class       text,
    association        text,
    description        text,
    broker_id          uuid references public.mk_brokers(id) on delete set null,
    images             jsonb not null default '[]'::jsonb,
    raw                jsonb not null default '{}'::jsonb,
    published_at       timestamptz,
    last_seen_at       timestamptz not null default now(),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (tenant_id, external_id),
    constraint mk_listings_status_chk check (status in ('kommande','till_salu','budgivning','såld','avtal','tillbakadragen'))
);
comment on table public.mk_listings is 'Strukturerad objektdata. Röstagenten frågar denna via verktygsanrop — inte vektorsök.';
comment on column public.mk_listings.last_seen_at is 'Sätts vid varje scrape/feed. Objekt som inte setts på länge kan markeras tillbakadragen.';

create index if not exists mk_listings_tenant_status_idx on public.mk_listings (tenant_id, status);
create index if not exists mk_listings_tenant_area_idx   on public.mk_listings (tenant_id, area);
create index if not exists mk_listings_tenant_price_idx  on public.mk_listings (tenant_id, price);
create index if not exists mk_listings_search_idx        on public.mk_listings
    using gin (to_tsvector('swedish', coalesce(headline,'') || ' ' || coalesce(street_address,'') || ' ' || coalesce(area,'') || ' ' || coalesce(municipality,'')));

create table if not exists public.mk_viewings (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references public.tenants(id) on delete cascade,
    listing_id   uuid not null references public.mk_listings(id) on delete cascade,
    external_id  text,
    starts_at    timestamptz not null,
    ends_at      timestamptz,
    viewing_type text not null default 'öppen',
    booking_url  text,
    capacity     integer,
    notes        text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (tenant_id, listing_id, starts_at)
);
comment on table public.mk_viewings is 'Visningstider per objekt. Röstagenten läser kommande, bokar via mk_leads.';
create index if not exists mk_viewings_tenant_time_idx on public.mk_viewings (tenant_id, starts_at);;
