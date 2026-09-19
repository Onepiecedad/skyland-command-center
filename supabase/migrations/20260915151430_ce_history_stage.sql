-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Mellanlager för WhatsApp Coexistence-historiken.
--
-- Importen görs i SQL med flit. Koden som skickar meddelanden bor i edge-
-- funktionen; gör vi det här i databasen är det fysiskt omöjligt att ett
-- gammalt meddelande råkar besvaras. Det var det hårdaste kravet.
--
-- Staging först, insert sedan, så vi kan titta på vad som kommer in innan
-- något rör ce_messages.

create table if not exists ce_history_stage (
    wamid        text primary key,
    motpart      text not null,          -- wa_id på den andra parten
    riktning     text not null check (riktning in ('inbound','outbound')),
    typ          text,
    kropp        text,
    skickad_at   timestamptz not null,
    lead_id      uuid,                   -- null = okänd motpart
    rapayload    jsonb not null,
    importerad   boolean not null default false,
    created_at   timestamptz not null default now()
);
comment on table ce_history_stage is
'Parsad Coexistence-historik. lead_id null = motpart finns inte i CRM. importerad = raden har skrivits till ce_messages.';

create index if not exists idx_hist_stage_motpart on ce_history_stage (motpart);
create index if not exists idx_hist_stage_lead on ce_history_stage (lead_id) where lead_id is not null;

alter table ce_history_stage enable row level security;
