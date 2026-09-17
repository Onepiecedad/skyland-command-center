-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Agentens eget långtidsminne, speglat från maskinen där OpenClaw kör.
--
-- Källan är arbetskatalogen ~/clawd: MEMORY.md (kurerat långtidsminne) och
-- memory/YYYY-MM-DD.md (dagliga sammanfattningar som compaction.memoryFlush
-- skriver när en session närmar sig tokentaket). Filerna ligger på VPS:en,
-- SCC:s backend kör på Render, och därför kunde dashboarden aldrig se dem.
-- scripts/sync_memory.sh på VPS:en skriver hit; SCC läser bara.
--
-- Spegling, inte källa: en rad som försvunnit ur katalogen markeras deleted_at
-- i stället för att raderas, så att historik inte tappas om ett skript felar.
create table if not exists public.agent_memory (
  id          uuid primary key default gen_random_uuid(),
  host        text not null,                       -- vilken maskin synkade
  agent       text not null default 'main',
  kind        text not null check (kind in ('longterm', 'daily')),
  path        text not null,                       -- relativt arbetskatalogen
  title       text,                                -- rubrik eller datum
  content     text not null,
  content_sha text not null,                       -- hoppa över oförändrade filer
  bytes       integer not null default 0,
  file_mtime  timestamptz,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (host, agent, path)
);

create index if not exists agent_memory_levande_idx
  on public.agent_memory (agent, kind, file_mtime desc) where deleted_at is null;
create index if not exists agent_memory_sok_idx
  on public.agent_memory using gin (to_tsvector('simple', coalesce(title,'') || ' ' || content))
  where deleted_at is null;

alter table public.agent_memory enable row level security;

-- Håll synced_at färsk även när innehållet är oförändrat
create or replace function public.agent_memory_touch() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

drop trigger if exists trg_agent_memory_touch on public.agent_memory;
create trigger trg_agent_memory_touch
  before update on public.agent_memory
  for each row execute function public.agent_memory_touch();
