-- Alla inkommande leads för Vinnie ska landa i "Ny".
--
-- Bakgrund: het-regeln träffade åtta av åtta leads i första backfillen. Dels på
-- svaret om storlek, dels på en generell fritextregel. Ett steg som alla passerar
-- bär ingen information, och Joakim ringer varje lead själv ändå — sorteringen
-- sker i telefon, inte i formuläret. Så vi tömmer hot_when och lämnar
-- hot_free_text avstängd. Funktionen lead-intake läser båda ur den här configen,
-- så det här är enda stället regeln bor.
--
-- Vill vi ha tillbaka ett hett steg senare sätter vi hot_when till något som
-- faktiskt särskiljer, och då bara det.

update meta_lead_routes
   set config = jsonb_set(
                  jsonb_set(config, '{hot_when}', '{}'::jsonb, true),
                  '{hot_free_text}', 'false'::jsonb, true)
 where page_id = '1021795327677822';

-- De åtta som redan ligger inne stämplades hot av den gamla regeln. Nolla dem;
-- ce_mirror_lead flyttar korten till första steget när raden uppdateras.
update ce_leads
   set hot_at = null,
       hot_reasons = '{}',
       custom = jsonb_set(coalesce(custom, '{}'::jsonb), '{priority}', '"warm"'::jsonb, true),
       updated_at = now()
 where tenant_id = (select id from tenants where slug = 'vinnie')
   and hot_at is not null;
