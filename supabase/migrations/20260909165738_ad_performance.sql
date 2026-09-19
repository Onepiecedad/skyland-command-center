-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Egna annonssiffror per kund. Konkurrentannonser ligger i ad_library;
-- det här är motsatsen: vad VÅRA annonser kostade och gav, per dag.

create table if not exists ad_accounts (
    id           uuid primary key default gen_random_uuid(),
    customer_id  uuid not null references customers(id) on delete cascade,
    platform     text not null default 'meta',
    account_id   text not null,          -- act_XXXXXXXXXX
    account_name text,
    currency     text,
    active       boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (platform, account_id)
);
comment on table ad_accounts is
'Kopplar ett annonskonto till en kund. En kund kan ha flera konton, ett konto hör till exakt en kund.';

create table if not exists ad_performance (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id) on delete cascade,
    platform       text not null default 'meta',
    account_id     text not null,
    date           date not null,
    campaign_id    text,
    campaign_name  text,
    adset_id       text,
    adset_name     text,
    ad_id          text not null,
    ad_name        text,
    -- Pengar och räckvidd
    spend          numeric(12,2) not null default 0,
    currency       text,
    impressions    bigint not null default 0,
    reach          bigint,
    frequency      numeric(8,3),
    clicks         bigint not null default 0,
    link_clicks    bigint,
    -- Metas egna kvoter sparas som de kommer, så vi kan jämföra mot Ads Manager
    ctr            numeric(10,5),
    cpc            numeric(12,4),
    cpm            numeric(12,4),
    -- Videoräknare. Hook rate och hold rate räknas fram i vyn, inte här,
    -- eftersom definitionen ska gå att ändra utan att datat hämtas om.
    video_plays    bigint,
    video_3s       bigint,
    video_p25      bigint,
    video_p50      bigint,
    video_p75      bigint,
    video_p100     bigint,
    -- Resultat enligt kampanjmålet (leads, meddelanden, köp ...)
    results        bigint,
    result_type    text,
    cost_per_result numeric(12,4),
    raw            jsonb not null default '{}'::jsonb,
    fetched_at     timestamptz not null default now(),
    unique (platform, ad_id, date)
);
comment on table ad_performance is
'En rad per annons och dag. Unik på (platform, ad_id, date) så en omkörning uppdaterar i stället för att dubblera.';
comment on column ad_performance.raw is
'Metas obearbetade svar för raden. Sparas för att nya mått ska kunna räknas fram i efterhand utan ny hämtning.';

create index if not exists idx_ad_perf_kund_datum on ad_performance (customer_id, date desc);
create index if not exists idx_ad_perf_annons     on ad_performance (ad_id, date desc);
create index if not exists idx_ad_perf_kampanj    on ad_performance (campaign_id, date desc);

create table if not exists ad_targets (
    id          uuid primary key default gen_random_uuid(),
    customer_id uuid not null references customers(id) on delete cascade,
    -- Vad målet gäller. 'customer' är standardnivån; en kampanj eller enskild
    -- annons kan ha ett eget mål som slår kundens.
    scope       text not null default 'customer' check (scope in ('customer','campaign','ad')),
    scope_id    text,
    -- Taket för vad ett resultat får kosta. En Krav Maga-provträning och en
    -- Lapplandsresa kan inte dömas med samma linjal, därför per kund.
    target_cost numeric(12,2) not null,
    -- Ingen annons döms innan den spenderat så här mycket. Utan golv pausar
    -- man på brus: tre visningar och noll resultat är inte ett misslyckande.
    spend_floor numeric(12,2) not null default 0,
    -- Hur långt över målet som är gult innan det blir rött. 0.25 = 25 procent.
    yellow_margin numeric(5,3) not null default 0.25,
    currency    text not null default 'SEK',
    note        text,
    active      boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
comment on table ad_targets is
'Mål och spendgolv per kund. Flaggningen i ad_health läser härifrån.';

create unique index if not exists idx_ad_targets_scope
    on ad_targets (customer_id, scope, coalesce(scope_id, '')) where active;

drop trigger if exists trg_ad_accounts_updated_at on ad_accounts;
create trigger trg_ad_accounts_updated_at before update on ad_accounts
    for each row execute function set_updated_at();
drop trigger if exists trg_ad_targets_updated_at on ad_targets;
create trigger trg_ad_targets_updated_at before update on ad_targets
    for each row execute function set_updated_at();

alter table ad_accounts    enable row level security;
alter table ad_performance enable row level security;
alter table ad_targets     enable row level security;
