-- Kontohändelser från Meta/Dualhook som inte hör till ett lead: ACCOUNT_OFFBOARDED,
-- PARTNER_REMOVED, kvalitetsändringar på numret, okända payloads. Append-only,
-- bara service role läser och skriver (RLS på, inga policies, samma som ce_jobs).
-- Bakgrund: 8 sep kom ACCOUNT_OFFBOARDED 27 s efter inkopplingen, avvisades med 401
-- och ingen såg det förrän nästa dag. Skrivs av ce-agent-webhook.
create table if not exists public.ce_account_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  source      text not null default 'whatsapp',   -- whatsapp | unknown_object
  field       text,                                -- account_update, phone_number_quality_update ...
  event       text not null,                       -- ACCOUNT_OFFBOARDED, PARTNER_REMOVED, unknown ...
  severity    text not null default 'info' check (severity in ('info','warn','alarm')),
  waba_id     text,
  phone       text,
  notified    jsonb not null default '{}'::jsonb,  -- {email: id|error, sms: id|error}
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ce_account_events_created_idx on public.ce_account_events (tenant_id, created_at desc);
alter table public.ce_account_events enable row level security;

create or replace function public.ce_account_events_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.allow_event_purge', true), 'false') = 'true' then
    return old;
  end if;
  raise exception 'ce_account_events är append-only (försökte %). Hård radering kräver app.allow_event_purge.', tg_op;
end $$;

drop trigger if exists trg_ce_account_events_append_only on public.ce_account_events;
create trigger trg_ce_account_events_append_only
  before update or delete on public.ce_account_events
  for each row execute function public.ce_account_events_append_only();
