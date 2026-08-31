-- 2026-08-31 — hämtar hem två ändringar som gjorts direkt i Supabase.
--
-- Prod har sedan skuggläget (SCC-46) 'shadow' i messages.status och 'instagram'
-- i messages.channel, men ändringarna fanns bara i databasen — inte här. En
-- rekonstruktion från repot hade gett en databas där varje skuggrad avvisas av
-- check-villkoret, alltså tyst trasigt skuggläge. Migrationen är idempotent och
-- ändrar ingenting i prod (villkoren är redan exakt så här).

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'delivered', 'bounced', 'complained', 'shadow'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook', 'instagram'));
