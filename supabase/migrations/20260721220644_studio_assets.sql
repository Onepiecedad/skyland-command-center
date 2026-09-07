
create table if not exists studio_assets (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null references contacts(id) on delete cascade,
    opportunity_id uuid references opportunities(id) on delete set null,
    kind text not null,                          -- landing|ad|carousel|video|poster|sheet|one-pager|internal-brief|other
    audience text not null default 'client',     -- internal | client
    title text not null,
    storage_path text not null,                  -- sökväg i bucketen studio-material
    mime text,
    file_size bigint,
    version int not null default 1,
    is_latest boolean not null default true,
    source text,                                 -- vem/vad som producerade den
    tags text[] not null default '{}',
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_studio_assets_contact on studio_assets(contact_id);
create index if not exists idx_studio_assets_contact_kind on studio_assets(contact_id, kind);
create index if not exists idx_studio_assets_latest on studio_assets(contact_id, kind, is_latest) where is_latest;
;
