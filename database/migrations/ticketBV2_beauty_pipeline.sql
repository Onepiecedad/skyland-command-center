-- BV-2 — Pipeline "Prospecting (Beauty)" (beauty-vertikalen)
-- Idempotent seed: samma stages som Prospecting (Agency) så auto-loggen vid
-- drag till Contacted och IG-webhookens Contacted→Replied-flytt fungerar
-- oförändrat. is_default rörs INTE (Agency förblir default).
-- Säker att köra flera gånger; ändrar inget befintligt.

INSERT INTO pipelines (name, is_default)
SELECT 'Prospecting (Beauty)', false
WHERE NOT EXISTS (
  SELECT 1 FROM pipelines WHERE name = 'Prospecting (Beauty)'
);

INSERT INTO stages (pipeline_id, name, position)
SELECT p.id, s.name, s.position
FROM pipelines p
CROSS JOIN (
  VALUES
    ('New Prospect',   0),
    ('Qualified',      1),
    ('Outreach Ready', 2),
    ('Contacted',      3),
    ('Replied',        4),
    ('Meeting Booked', 5),
    ('Won',            6),
    ('No Fit',         7)
) AS s(name, position)
WHERE p.name = 'Prospecting (Beauty)'
  AND NOT EXISTS (
    SELECT 1 FROM stages st
    WHERE st.pipeline_id = p.id AND st.name = s.name
  );
