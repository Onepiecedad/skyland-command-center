-- Sidan som ägaren anslutit via Facebook-inloggning för företag.
create table if not exists ce_page_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  page_id text not null,
  page_name text,
  page_token text not null,
  granted_scopes text[] not null default '{}',
  subscribed_fields text[] not null default '{}',
  connected_by_asid text,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, page_id)
);
alter table ce_page_connections enable row level security;
comment on table ce_page_connections is
  'Sidtoken från anslutningsflödet. RLS på utan policies, alltså bara service role. page_token är en hemlighet.';

-- Kortlivad session mellan steg 1 (kodväxling) och steg 2 (val av sida).
create table if not exists ce_connect_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_token text not null,
  asid text,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ce_connect_sessions enable row level security;
comment on table ce_connect_sessions is
  'Håller användartoken i högst 10 minuter medan ägaren väljer sida. Raderas direkt efter användning.';

-- Koppling mellan Facebook-inloggningens ASID och Messenger-PSID, så att
-- Metas raderingscallback hittar rätt person oavsett vilket id den skickar.
alter table ce_conversations add column if not exists external_asid text;
create index if not exists ce_conversations_asid_idx on ce_conversations (tenant_id, external_asid);;
