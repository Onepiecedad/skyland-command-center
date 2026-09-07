alter table costs add column if not exists meta jsonb not null default '{}'::jsonb;
comment on column costs.meta is 'Fritt sammanhang per rad, t.ex. {"contact":"Laser4you","vertical":"beauty","attempts":1,"duration_s":300,"result":"ok"} från prospect_pipeline (plan 2.4).';;
