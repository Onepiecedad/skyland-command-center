-- ============================================================================
-- SEQ-7 / SCC-46 — wait_until-steg (absolut tid, t.ex. "24h innan mötet")
-- Lägger till steg-typen 'wait_until'. Väntetiden räknas relativt en bastid i
-- enrollmentens context (t.ex. booking_start) + en offset i config. Idempotent.
-- ============================================================================

ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_type_check
    CHECK (type IN (
        'send_email', 'send_sms', 'wait', 'wait_until', 'branch',
        'move_stage', 'add_tag', 'remove_tag', 'create_task', 'webhook', 'exit'
    ));
