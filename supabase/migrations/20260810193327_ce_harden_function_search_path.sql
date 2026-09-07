-- ============================================================================
-- Härdning: lås search_path på alla nya funktioner.
-- current_tenant_id() används i RLS-policies — en mutabel search_path där är
-- en reell väg runt tenant-isoleringen.
-- ============================================================================
ALTER FUNCTION current_tenant_id()               SET search_path = public, pg_temp;
ALTER FUNCTION tenant_id_by_slug(text)           SET search_path = public, pg_temp;
ALTER FUNCTION set_updated_at()                  SET search_path = public, pg_temp;
ALTER FUNCTION ce_valid_transition(text, text)   SET search_path = public, pg_temp;
ALTER FUNCTION ce_leads_status_guard()           SET search_path = public, pg_temp;
ALTER FUNCTION ce_leads_status_log()             SET search_path = public, pg_temp;
ALTER FUNCTION ce_conv_human_guard()             SET search_path = public, pg_temp;
ALTER FUNCTION ce_conv_human_log()               SET search_path = public, pg_temp;
ALTER FUNCTION ce_events_append_only()           SET search_path = public, pg_temp;
ALTER FUNCTION ce_touch_windows()                SET search_path = public, pg_temp;
ALTER FUNCTION ce_send_policy(uuid)              SET search_path = public, pg_temp;
ALTER FUNCTION ce_is_opt_out_phrase(text)        SET search_path = public, pg_temp;
ALTER FUNCTION ce_opt_out(uuid, text)            SET search_path = public, pg_temp;
ALTER FUNCTION ce_detect_opt_out()               SET search_path = public, pg_temp;
ALTER FUNCTION ce_erase_lead(uuid, text)         SET search_path = public, pg_temp;
;
