create table if not exists suppression_list (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('email','phone','domain')),
  value       text not null,
  reason      text,
  source      text,
  contact_id  uuid references contacts(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);
comment on table suppression_list is
  'Spärrlista för outbound. Träff på exakt adress/nummer eller hel domän stoppar utskick och avslutar sekvensen (exit_reason=suppressed).';
create index if not exists suppression_list_kind_value_idx on suppression_list (kind, value);
alter table suppression_list enable row level security;
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status = any (array['queued','sent','failed','delivered','bounced','complained','shadow']));
create index if not exists messages_outbound_status_created_idx
  on messages (direction, status, created_at);;
