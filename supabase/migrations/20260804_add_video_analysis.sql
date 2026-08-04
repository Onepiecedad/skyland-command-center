-- Migration: video_analysis på ad_library (applicerad i prod 2026-08-04 via Supabase MCP).
-- Strukturerad videoanalys per annons (video-watch-skillen skriver, ad-intel läser).
-- Schema för video_analysis (jsonb):
--   hook: {typ, sekunder, beskrivning}
--   klipprytm: text (snabb/medel/lugn + ev. antal klipp)
--   text_on_screen: [{tid, text}]
--   cta: {tidpunkt, typ, text}
--   manniskor, miljo, ljud, helhetsintryck: text
alter table ad_library
  add column if not exists video_analysis jsonb,
  add column if not exists video_analyzed_at timestamptz;

comment on column ad_library.video_analysis is
  'Strukturerad analys av videokreativet (video-watch-skillen). Fast schema: hook{typ,sekunder,beskrivning}, klipprytm, text_on_screen[], cta{tidpunkt,typ,text}, manniskor, miljo, ljud, helhetsintryck.';
