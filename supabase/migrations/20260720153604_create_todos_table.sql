
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  done boolean not null default false,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  contact_id uuid references contacts(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  source text not null default 'manual',
  auto_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_todos_done on todos(done);
create index if not exists idx_todos_due on todos(due_at);
create index if not exists idx_todos_contact on todos(contact_id);
-- Bara en öppen auto-todo per nyckel (t.ex. "reply:<contact_id>") — släpps när den bockas av.
create unique index if not exists uq_todos_auto_open on todos(auto_key) where done = false and auto_key is not null;
;
