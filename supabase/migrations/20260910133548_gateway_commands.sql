-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Knapptryck fran panelen som maste utforas pa VPS:en.
-- Render nar varken gatewayn (loopback) eller openclaw-CLI:t, sa panelen koar
-- ett kommando har och VPS:en hamtar det. Samma pull-riktning som allt annat.
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

-- En knapp ska inte kunna koa samma sak tio ganger medan den forsta vantar.
create unique index if not exists gateway_commands_en_i_taget
    on gateway_commands (kind, job_id)
    where status in ('pending','claimed');

create index if not exists gateway_commands_kö
    on gateway_commands (status, requested_at);
