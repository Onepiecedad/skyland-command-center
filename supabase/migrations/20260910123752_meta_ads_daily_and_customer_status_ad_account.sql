-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Annonsstatistik per kund, kampanj och dygn.
-- Tokenet bor pa VPS:en; den skickar hit raderna via SCC:s API. En hemlighet,
-- ett stalle. Rader ar idempotenta pa (customer_id, date, campaign_id) sa att
-- en omkorning av samma dygn skriver over i stallet for att dubblera.
create table if not exists meta_ads_daily (
    id            uuid primary key default gen_random_uuid(),
    customer_id   uuid not null references customers(id) on delete cascade,
    ad_account_id text not null,
    date          date not null,
    campaign_id   text not null,
    campaign_name text,
    spend         numeric(12,2) not null default 0,
    impressions   bigint not null default 0,
    clicks        bigint not null default 0,
    leads         bigint not null default 0,
    currency      text not null default 'SEK',
    fetched_at    timestamptz not null default now(),
    unique (customer_id, date, campaign_id)
);

create index if not exists meta_ads_daily_kund_datum
    on meta_ads_daily (customer_id, date desc);

-- Samma monster som site_tenant_slug: vyn exponerar om kunden HAR ett
-- annonskonto, sa att granssnittet kan visa fliken utan att lasa config.
create or replace view customer_status as
 WITH recent_activities AS (
         SELECT activities.customer_id,
            count(*) FILTER (WHERE activities.severity = 'error'::text AND activities.created_at > (now() - '24:00:00'::interval)) AS errors_24h,
            count(*) FILTER (WHERE activities.severity = 'warn'::text AND activities.created_at > (now() - '24:00:00'::interval)) AS warnings_24h,
            max(activities.created_at) AS last_activity
           FROM activities
          WHERE activities.customer_id IS NOT NULL
          GROUP BY activities.customer_id
        ), pending_tasks AS (
         SELECT tasks.customer_id,
            count(*) FILTER (WHERE tasks.status = ANY (ARRAY['created'::text, 'assigned'::text, 'in_progress'::text, 'review'::text])) AS open_tasks,
            count(*) FILTER (WHERE tasks.status = 'failed'::text AND tasks.updated_at > (now() - '24:00:00'::interval)) AS failed_tasks_24h
           FROM tasks
          WHERE tasks.customer_id IS NOT NULL
          GROUP BY tasks.customer_id
        ), crm_contacts AS (
         SELECT contacts.customer_id,
            count(*) AS contacts_count
           FROM contacts
          WHERE contacts.customer_id IS NOT NULL
          GROUP BY contacts.customer_id
        ), crm_opps AS (
         SELECT opportunities.customer_id,
            count(*) AS open_opportunities
           FROM opportunities
          WHERE opportunities.status = 'open'::text AND opportunities.customer_id IS NOT NULL
          GROUP BY opportunities.customer_id
        )
 SELECT c.id,
    c.name,
    c.slug,
    COALESCE(ra.errors_24h, 0::bigint) AS errors_24h,
    COALESCE(ra.warnings_24h, 0::bigint) AS warnings_24h,
    COALESCE(pt.open_tasks, 0::bigint) AS open_tasks,
    COALESCE(pt.failed_tasks_24h, 0::bigint) AS failed_tasks_24h,
    ra.last_activity,
        CASE
            WHEN COALESCE(ra.errors_24h, 0::bigint) > 0 OR COALESCE(pt.failed_tasks_24h, 0::bigint) > 0 THEN 'error'::text
            WHEN COALESCE(ra.warnings_24h, 0::bigint) > 2 OR COALESCE(pt.open_tasks, 0::bigint) > 10 THEN 'warning'::text
            ELSE 'active'::text
        END AS status,
    COALESCE(cc.contacts_count, 0::bigint) AS contacts_count,
    COALESCE(co.open_opportunities, 0::bigint) AS open_opportunities,
    c.site_tenant_id,
    st.slug AS site_tenant_slug,
    NULLIF(c.config -> 'meta' ->> 'ad_account_id', '') AS meta_ad_account_id
   FROM customers c
     LEFT JOIN recent_activities ra ON ra.customer_id = c.id
     LEFT JOIN pending_tasks pt ON pt.customer_id = c.id
     LEFT JOIN crm_contacts cc ON cc.customer_id = c.id
     LEFT JOIN crm_opps co ON co.customer_id = c.id
     LEFT JOIN tenants st ON st.id = c.site_tenant_id;
