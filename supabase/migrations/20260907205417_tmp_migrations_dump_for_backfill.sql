-- Tillfallig. Enda syftet ar att kunna skriva ner migrationerna till repot fran
-- Joakims egen dator utan att de passerar nagon mellanhand. Droppas direkt efterat.
-- Endast service_role far kora den; anon och authenticated far uttryckligen inte.
create or replace function public.__migrations_dump()
returns table (version text, name text, sql text, md5 text)
language sql
security definer
set search_path = supabase_migrations, public
as $$
  select m.version,
         m.name,
         array_to_string(m.statements, E';\n\n') || ';',
         md5(array_to_string(m.statements, E';\n\n') || ';')
  from supabase_migrations.schema_migrations m
  order by m.version
$$;

revoke all on function public.__migrations_dump() from public, anon, authenticated;
grant execute on function public.__migrations_dump() to service_role;
