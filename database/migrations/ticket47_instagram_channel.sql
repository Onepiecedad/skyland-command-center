-- Ticket 47 — 'instagram' som tillåten kanal i messages.
-- IG DM är den primära outreach-kanalen mot tatuerar-prospekten; utan detta
-- kan interaktionerna inte loggas där all annan kommunikation bor.
-- Applicerad i Supabase 2026-07-15 (via MCP apply_migration: instagram_channel_in_messages).

alter table messages drop constraint messages_channel_check;
alter table messages add constraint messages_channel_check
  check (channel = any (array['chat'::text, 'voice'::text, 'email'::text, 'sms'::text, 'whatsapp'::text, 'webhook'::text, 'instagram'::text]));
