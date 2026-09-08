-- Het låg efter Kvalificerad i vyn, men regeln kollade status före hetstämpel.
-- Ett hett lead flyttade sig alltså BAKÅT så fort en konversation startade.
-- Med en kund idag är det ett kort. Med WhatsApp igång är det varje het gäst
-- som svarar roboten, och Gustavs ringlista hade tömt sig själv precis när
-- leadsen började engagera sig.
--
-- Hetstämpeln väger nu tyngre än en pågående konversation, men aldrig tyngre än
-- ett avslut: avböjt, bokat, betalt och överlämnat ligger kvar över den.
create or replace function public.ce_stage_for(p_status text, p_hot boolean)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_status in ('cold','nurture','opted_out','lost')       then 'Avböjt'
    when p_status = 'paid'                                       then 'Betald'
    when p_status = 'booked'                                     then 'Bokad'
    when p_status = 'handed_off'                                 then 'Överlämnad'
    when p_status = 'hot'                                        then 'Het'
    -- Het är Gustavs ringlista. En gäst som sagt ja i formuläret ligger kvar
    -- där tills hon lämnas över eller tackar nej, oavsett om roboten under
    -- tiden pratar med henne. Formulärleads stämplas hot_at men behåller
    -- status 'new', eftersom new -> hot inte är en tillåten övergång.
    when p_hot                                                   then 'Het'
    when p_status in ('in_conversation','qualifying','contacted') then 'Kvalificerad'
    else 'Ny'
  end;
$function$;

-- Den gamla överlagringen på (text, text) användes bara av migrationer som
-- redan är ersatta. Två funktioner med samma namn som skiljer sig på
-- argumenttyp är en fälla: ett anrop med en intent-sträng hade tyst valt fel.
drop function if exists public.ce_stage_for(text, text);
