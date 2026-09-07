-- Schema-drift från hemsidans live-DB: source/status/updated_at fanns i drift men inte i repo-migrationen
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS status text DEFAULT 'new';
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
NOTIFY pgrst, 'reload schema';;
