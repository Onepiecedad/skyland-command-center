create table if not exists ce_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  platform text not null default 'messenger',
  platform_user_id text not null,
  confirmation_code text not null unique,
  status text not null default 'received',
  leads_affected int not null default 0,
  messages_redacted int not null default 0,
  detail jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ce_deletion_requests_user_idx on ce_deletion_requests (tenant_id, platform_user_id);
alter table ce_deletion_requests enable row level security;
comment on table ce_deletion_requests is
  'Metas Data Deletion Request Callback. En rad per begäran, confirmation_code visas för användaren och för Metas granskare på statussidan.';;
