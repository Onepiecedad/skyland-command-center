create table if not exists public.ce_settings (
  tenant_id uuid not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table public.ce_settings enable row level security;
comment on table public.ce_settings is 'Driftflaggor per tenant. autopilot=on|off styr om agenten och första mejlet får skickas till kunder.';
insert into public.ce_settings (tenant_id, key, value) values ('1a215fa9-80cd-4ae1-a89d-796b473fc74f','autopilot','off')
on conflict (tenant_id, key) do update set value='off', updated_at=now();;
