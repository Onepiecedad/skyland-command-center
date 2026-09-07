-- Anonym telemetri från skyland-ai-os.netlify.app.
-- Inga persondata: ingen IP, ingen user-agent, ingen fingerprinting.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  session_uuid uuid not null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_session_idx on public.events (session_uuid, created_at);
create index if not exists events_type_created_idx on public.events (type, created_at desc);
create index if not exists events_created_idx on public.events (created_at desc);

alter table public.events enable row level security;
-- Ingen anon-åtkomst: skrivningar går via n8n (service role), läsning via SCC-backend (service role).;
