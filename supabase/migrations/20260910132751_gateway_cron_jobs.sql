-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Schemalagda jobb speglade fran gatewayns sqlite pa VPS:en.
-- Backenden kor pa Render och kan inte lasa den filen; VPS:en pushar hit,
-- samma riktning som claw-pollern och meta_ads_sync.
create table if not exists gateway_cron_jobs (
    job_id          text primary key,
    name            text not null,
    enabled         boolean not null default true,
    schedule_expr   text,
    schedule_tz     text,
    next_run_at     timestamptz,
    last_run_at     timestamptz,
    last_run_status text,
    run_count       integer not null default 0,
    last_error      text,
    last_summary    text,
    agent_id        text,
    synced_at       timestamptz not null default now()
);

create index if not exists gateway_cron_jobs_synk on gateway_cron_jobs (synced_at desc);
