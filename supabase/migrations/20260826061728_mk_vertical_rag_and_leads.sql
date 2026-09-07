-- RAG-lagret (statiskt innehåll) och leads.

create table if not exists public.mk_documents (
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references public.tenants(id) on delete cascade,
    source_url   text not null,
    title        text,
    category     text,
    chunk_index  integer not null default 0,
    content      text not null,
    token_count  integer,
    embedding    vector(1536),
    metadata     jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    unique (tenant_id, source_url, chunk_index)
);
comment on table public.mk_documents is 'Vektorlager för statiskt innehåll (om byrån, process, arvoden, områdesbeskrivningar). Objektdata hör inte hemma här.';
create index if not exists mk_documents_tenant_url_idx on public.mk_documents (tenant_id, source_url);
create index if not exists mk_documents_embedding_idx on public.mk_documents
    using hnsw (embedding vector_cosine_ops);

create table if not exists public.mk_crawl_pages (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    url             text not null,
    content_hash    text,
    status          text not null default 'pending',
    error           text,
    chunk_count     integer not null default 0,
    last_crawled_at timestamptz,
    last_indexed_at timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, url),
    constraint mk_crawl_pages_status_chk check (status in ('pending','ok','unchanged','failed','skipped'))
);
comment on table public.mk_crawl_pages is 'Crawl-register. content_hash gör veckorefreshen billig — bara ändrade sidor embeddas om.';

create table if not exists public.mk_leads (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete cascade,
    name                text,
    phone               text,
    email               text,
    intent              text not null default 'ovrigt',
    listing_id          uuid references public.mk_listings(id) on delete set null,
    viewing_id          uuid references public.mk_viewings(id) on delete set null,
    callback_requested  boolean not null default false,
    preferred_time      text,
    message             text,
    source              text not null default 'voice',
    channel             text,
    external_call_id    text,
    status              text not null default 'ny',
    consent_contact     boolean not null default false,
    qualification       jsonb not null default '{}'::jsonb,
    dedupe_key          text,
    handed_off_at       timestamptz,
    opted_out_at        timestamptz,
    erased_at           timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint mk_leads_intent_chk check (intent in ('kopa','salja','vardering','visning','ovrigt')),
    constraint mk_leads_status_chk check (status in ('ny','kontaktad','bokad','kvalificerad','forlorad'))
);
comment on table public.mk_leads is 'Leads från röstagenten. Datan tillhör tenanten och ska vara exporterbar när som helst.';
create unique index if not exists mk_leads_dedupe_idx on public.mk_leads (tenant_id, dedupe_key) where dedupe_key is not null;
create index if not exists mk_leads_tenant_status_idx on public.mk_leads (tenant_id, status, created_at desc);

create table if not exists public.mk_lead_events (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants(id) on delete cascade,
    lead_id     uuid not null references public.mk_leads(id) on delete cascade,
    event_type  text not null,
    from_status text,
    to_status   text,
    payload     jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
comment on table public.mk_lead_events is 'Append-only. Statusövergångar, handoff, opt-out. Underlag för provisionsavstämning.';
create index if not exists mk_lead_events_lead_idx on public.mk_lead_events (lead_id, created_at);;
