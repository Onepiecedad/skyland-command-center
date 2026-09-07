-- Testet visade att ett hett lead stannade i Het även efter att agenten börjat
-- prata med det. Fel för Gustavs arbetssätt: Het ska vara ringlistan, alltså heta
-- leads som INGEN engagerat än. Så fort en konversation är igång hör kortet hemma
-- i Kvalificerad, för då sköter agenten det och Gustav ska inte ringa förbi.
create or replace function ce_stage_for(p_status text, p_hot boolean)
returns text language sql immutable as $$
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
$$;

-- Spegla om alla med den nya regeln.
do $$
declare r record;
begin
  for r in select id from ce_lead_overview loop perform ce_mirror_lead(r.id); end loop;
end $$;;
