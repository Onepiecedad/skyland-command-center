-- Cold Experience får samma spårning som MarinMekaniker och Skyland.
-- Sajten tar inte betalt, bokningen är en förfrågan, så det finns inget
-- avslutssteg. Språkfördelningen behålls däremot: sajten finns på fyra språk
-- och vilket besökaren kommer in på säger något.
update public.tenants
set allowed_origins = array['https://coldexperience.se', 'https://www.coldexperience.se'],
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'webb', jsonb_build_object(
        'sajt', 'coldexperience.se',
        'engagemang', jsonb_build_array('upplevelse_visad', 'form_start'),
        'lead',       jsonb_build_array('form_submit'),
        'avslut',     jsonb_build_array(),
        'visa',       jsonb_build_array('besok', 'engagemang', 'lead', 'sprak')
      )
    )
where slug = 'cold-experience';

update public.customers
set site_tenant_id = (select id from public.tenants where slug = 'cold-experience')
where slug = 'gustav';

select c.name, t.slug as sajt, t.allowed_origins
from customers c join tenants t on t.id = c.site_tenant_id;;
