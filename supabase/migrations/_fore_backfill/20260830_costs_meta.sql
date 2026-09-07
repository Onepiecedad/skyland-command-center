-- Migration: costs.meta (plan 2.4) — kostnads- och tidsmätare per pipeline-körning.
-- costs var byggd för ren API-spend (provider/agent/dag). Pipelines behöver kunna
-- stämpla VAD som kördes: kort, vertikal, antal försök, väggtid, utfall. Det får
-- plats i en jsonb-kolumn utan att röra dashboardens aggregat.
alter table costs add column if not exists meta jsonb not null default '{}'::jsonb;
comment on column costs.meta is
  'Fritt sammanhang per rad, t.ex. {"contact":"Laser4you","vertical":"beauty","attempts":1,"duration_s":300,"result":"ok"} från prospect_pipeline (plan 2.4).';
