-- Återställer regeln från 20260907135240. Den tidigare migrationen idag
-- (20260908151555) vände på prioriteringen utan att känna till varför den såg
-- ut som den gjorde. Skälet står i scc-crm/references/crm-spegling.md:
--
--   "Het är avsiktligt en ringlista och inte en fas. Så fort en konversation
--    startar flyttas kortet till Kvalificerad, annars ringer Gustav förbi en
--    gäst som agenten håller på med."
--
-- Maskinen är alltså: Het = het och orörd av alla, Kvalificerad = roboten
-- kvalificerar, Överlämnad = Gustavs riktiga kö. Att Het ser full ut nu beror
-- bara på att autopiloten är av.
--
-- Det som faktiskt var trasigt var ETT kort: Jayeeta Dey sattes till
-- in_conversation av ett klick i CRM:et trots noll meddelanden. Hon står nu som
-- 'hot' och fångas av den första grenen, oberoende av den här regeln.
--
-- Borttagningen av den döda överlagringen ce_stage_for(text, text) i
-- 20260908151555 står kvar. Den hörde inte ihop med prioriteringen.
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
    when p_status in ('in_conversation','qualifying')            then 'Kvalificerad'
    -- Formulärleads som svarat ja stämplas hot_at men behåller status 'new',
    -- eftersom new -> hot inte är en tillåten övergång. De är ringlistan.
    when p_hot and p_status in ('new','contacted')               then 'Het'
    when p_status = 'contacted'                                  then 'Kvalificerad'
    else 'Ny'
  end;
$function$;
