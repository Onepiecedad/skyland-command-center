-- Migration: suppression_list (SCC-46, databasreaktivering).
-- Adresser/nummer/domäner som ALDRIG får kontaktas av sekvensmotorn eller comms:
-- bounces och complaints (Resend-webhook), avböjda svar, befintliga kunder.
-- Kontrolleras före varje utskick, även i skuggläge (OUTBOUND_MODE=shadow).
create table if not exists suppression_list (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('email','phone','domain')),
  value       text not null,                       -- normaliserad: lowercase, telefon utan mellanslag/bindestreck
  reason      text,                                -- 'bounce' | 'complaint' | 'opted_out' | 'existing_customer' | 'manual' | ...
  source      text,                                -- 'resend_webhook' | 'reply_classifier' | 'operator' | 'seed'
  contact_id  uuid references contacts(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);
comment on table suppression_list is
  'Spärrlista för outbound. Träff på exakt adress/nummer eller hel domän stoppar utskick och avslutar sekvensen (exit_reason=suppressed).';
create index if not exists suppression_list_kind_value_idx on suppression_list (kind, value);

alter table suppression_list enable row level security;
-- Backend går via service role; ingen anon-policy.

-- messages.status='shadow' används av skuggläget → utöka CHECK-constrainten.
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status = any (array['queued','sent','failed','delivered','bounced','complained','shadow']));
-- Indexet gör dagsbudget-räkningen (outbound, ej shadow, idag) billig.
create index if not exists messages_outbound_status_created_idx
  on messages (direction, status, created_at);
