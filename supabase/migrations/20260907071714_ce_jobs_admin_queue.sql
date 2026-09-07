create table if not exists public.ce_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists idx_ce_jobs_pending on public.ce_jobs (tenant_id, status, created_at);
alter table public.ce_jobs enable row level security;
comment on table public.ce_jobs is 'Administrativa jobb för ce-edge-functions (test_email, send_first_emails). Endast service role; ingen policy = ingen klientåtkomst.';;
