-- gateway_commands — kön som gör panelens knappar användbara igen.
--
-- Backenden kör på Render och når varken gatewayns loopback-port eller
-- `openclaw`-CLI:t, så "Kör nu" och av/på svarade 501. Nu skriver en
-- knapptryckning en rad här; VPS:en (openclaw-config/scripts/gateway_commands.py,
-- cron varje minut) dränerar kön, kör kommandot lokalt och skriver tillbaka
-- resultatet. Samma riktning som cron-speglingen och annonssynken.
create table if not exists gateway_commands (
    id           uuid primary key default gen_random_uuid(),
    kind         text not null check (kind in ('run','enable','disable')),
    job_id       text not null,
    job_name     text,
    status       text not null default 'pending' check (status in ('pending','claimed','done','failed')),
    requested_by text,
    requested_at timestamptz not null default now(),
    claimed_at   timestamptz,
    finished_at  timestamptz,
    result       text,
    error        text
);

-- Ett väntande kommando per jobb och typ: dubbeltryck ska inte köa två körningar.
create unique index if not exists gateway_commands_en_i_taget
    on gateway_commands (kind, job_id) where status in ('pending','claimed');

create index if not exists gateway_commands_kö on gateway_commands (status, requested_at);
