-- Webbspårningen var byggd för en enda sajt. Här får den lära sig skilja på kunder.

-- 1. Sajtnyckel och tillåtna avsändare per tenant.
--    Nyckeln ligger i webbläsaren och är alltså ingen hemlighet. Det är
--    origin-kontrollen i ingest-rutten som gör det riktiga jobbet.
alter table public.tenants
  add column if not exists site_key text,
  add column if not exists allowed_origins text[] not null default '{}';

-- 2. MarinMekaniker som egen tenant, kopplad till Thomas kundkort.
insert into public.tenants (slug, name, vertical, status, allowed_origins)
values (
  'marinmekaniker',
  'MarinMekaniker.nu',
  'marin',
  'active',
  array['https://marinmekaniker.nu', 'https://www.marinmekaniker.nu']
)
on conflict (slug) do nothing;

update public.tenants
set site_key = 'sk_' || replace(gen_random_uuid()::text, '-', '')
where site_key is null;

alter table public.tenants
  add constraint tenants_site_key_unique unique (site_key);

update public.tenants
set allowed_origins = array['https://skylandai.se', 'https://www.skylandai.se']
where slug = 'skyland' and allowed_origins = '{}';

update public.customers
set tenant_id = (select id from public.tenants where slug = 'marinmekaniker')
where slug = 'thomas' and tenant_id is null;

-- 3. Sessioner och händelser får veta vilken sajt de kommer från.
--    Default pekar på skyland så att den befintliga spårningen fortsätter
--    fungera oförändrad tills dess ingest-rutt börjar skicka tenant själv.
alter table public.sessions
  add column if not exists tenant_id uuid references public.tenants(id)
  default '8270706f-5bf8-4996-804b-a30fba20831d';

alter table public.events
  add column if not exists tenant_id uuid references public.tenants(id)
  default '8270706f-5bf8-4996-804b-a30fba20831d';

update public.sessions set tenant_id = '8270706f-5bf8-4996-804b-a30fba20831d' where tenant_id is null;

update public.events e
set tenant_id = coalesce(
  (select s.tenant_id from public.sessions s where s.session_uuid = e.session_uuid limit 1),
  '8270706f-5bf8-4996-804b-a30fba20831d'
)
where e.tenant_id is null;

alter table public.sessions alter column tenant_id set not null;
alter table public.events   alter column tenant_id set not null;

create index if not exists sessions_tenant_tid_idx on public.sessions (tenant_id, created_at desc);
create index if not exists events_tenant_tid_idx   on public.events   (tenant_id, created_at desc);
create index if not exists events_tenant_type_idx  on public.events   (tenant_id, type);;
