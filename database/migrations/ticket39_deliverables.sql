-- SCC-39 — DB-baserat arkiv: deliverables flyttar från ~/clawd/archive (fil) till Supabase.
-- Additiv; frontendens kontrakt (entries/report/artifacts) bevaras av routen.

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'report',
  entity JSONB NOT NULL DEFAULT '{}',
  status TEXT,
  score NUMERIC,
  gate_pass BOOLEAN,
  title TEXT,
  summary TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  report_md TEXT,
  artifacts JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'api',
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  contact_id UUID,
  date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliverables_type ON deliverables (type);
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables (status);
CREATE INDEX IF NOT EXISTS idx_deliverables_date ON deliverables (date DESC NULLS LAST);
