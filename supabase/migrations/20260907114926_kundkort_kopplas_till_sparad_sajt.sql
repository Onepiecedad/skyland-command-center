-- customers.tenant_id betyder vem som äger kundposten (Skyland), inte vilken
-- sajt som spåras. Den lämnas orörd. Sajtkopplingen får en egen kolumn.
alter table public.customers
  add column if not exists site_tenant_id uuid references public.tenants(id);

comment on column public.customers.site_tenant_id is
  'Tenanten vars webbspårning hör till den här kunden. Skild från tenant_id, som är ägaren av kundposten.';

update public.customers
set site_tenant_id = (select id from public.tenants where slug = 'marinmekaniker')
where slug = 'thomas';

-- Vad som räknas som engagemang och lead skiljer sig per sajt. Tratten läses
-- härifrån istället för att vara hårdkodad mot skylandai.se.
update public.tenants
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'webb', jsonb_build_object(
    'sajt', 'marinmekaniker.nu',
    'engagemang', jsonb_build_array('bestall_start', 'kit_valt', 'form_start'),
    'lead',       jsonb_build_array('form_submit', 'tel_klick'),
    'avslut',     jsonb_build_array('swish_start', 'swish_betald'),
    'visa',       jsonb_build_array('besok', 'engagemang', 'lead', 'avslut')
  )
)
where slug = 'marinmekaniker';;
