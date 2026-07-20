-- ============================================================================
-- TODOS TABLE — operatörens att-göra-lista ("ska ske"-linsen)
-- Applicerad i prod 2026-07-20. Delas av routes/todos.ts (manuella) och
-- auto-generering från pipeline-/DM-händelser (services/todos.ts).
-- ============================================================================

CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  notes TEXT,
  done BOOLEAN NOT NULL DEFAULT false,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  auto_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_at);
CREATE INDEX IF NOT EXISTS idx_todos_contact ON todos(contact_id);

-- Bara EN öppen auto-todo per nyckel (t.ex. "reply:<contact_id>", "meeting:<opp_id>").
-- Släpps automatiskt när todon bockas av (done = true) → nästa händelse kan skapa en ny.
CREATE UNIQUE INDEX IF NOT EXISTS uq_todos_auto_open ON todos(auto_key)
  WHERE done = false AND auto_key IS NOT NULL;
