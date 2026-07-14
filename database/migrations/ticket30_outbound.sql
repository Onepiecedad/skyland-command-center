-- SCC-30 — Outbound messaging: leveransstatus + leverantörs-id på messages.
-- Additiv migration; befintliga rader påverkas inte (status NULL = ej relevant).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IN ('queued', 'sent', 'failed', 'delivered', 'bounced', 'complained'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id
  ON messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_outbound_created
  ON messages (created_at)
  WHERE direction = 'outbound';
