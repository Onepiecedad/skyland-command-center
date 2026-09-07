CREATE OR REPLACE VIEW customer_status AS
WITH recent_activities AS (
    SELECT customer_id,
      COUNT(*) FILTER (WHERE severity = 'error' AND created_at > now() - interval '24 hours') as errors_24h,
      COUNT(*) FILTER (WHERE severity = 'warn'  AND created_at > now() - interval '24 hours') as warnings_24h,
      MAX(created_at) as last_activity
    FROM activities
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  pending_tasks AS (
    SELECT customer_id,
      COUNT(*) FILTER (WHERE status IN ('created', 'assigned', 'in_progress', 'review')) as open_tasks,
      COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours') as failed_tasks_24h
    FROM tasks
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  crm_contacts AS (
    SELECT customer_id, COUNT(*) as contacts_count
    FROM contacts
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  crm_opps AS (
    SELECT customer_id, COUNT(*) as open_opportunities
    FROM opportunities
    WHERE status = 'open' AND customer_id IS NOT NULL
    GROUP BY customer_id
  )
SELECT c.id,
  c.name,
  c.slug,
  COALESCE(ra.errors_24h, 0) as errors_24h,
  COALESCE(ra.warnings_24h, 0) as warnings_24h,
  COALESCE(pt.open_tasks, 0) as open_tasks,
  COALESCE(pt.failed_tasks_24h, 0) as failed_tasks_24h,
  ra.last_activity,
  CASE
    WHEN COALESCE(ra.errors_24h, 0) > 0 OR COALESCE(pt.failed_tasks_24h, 0) > 0 THEN 'error'
    WHEN COALESCE(ra.warnings_24h, 0) > 2 OR COALESCE(pt.open_tasks, 0) > 10 THEN 'warning'
    ELSE 'active'
  END as status,
  COALESCE(cc.contacts_count, 0) as contacts_count,
  COALESCE(co.open_opportunities, 0) as open_opportunities
FROM customers c
  LEFT JOIN recent_activities ra ON ra.customer_id = c.id
  LEFT JOIN pending_tasks pt ON pt.customer_id = c.id
  LEFT JOIN crm_contacts cc ON cc.customer_id = c.id
  LEFT JOIN crm_opps co ON co.customer_id = c.id;;
