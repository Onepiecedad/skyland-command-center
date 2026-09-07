-- Första försöket tog allt efter kommat och förstörde "Snipen, Gamla Särövägen 491",
-- där gårdsnamnet står först och gatan efter. Ta bort bara kända tillägg.
create or replace function public.mk_spoken_address(a text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select nullif(trim(
        regexp_replace(
            regexp_replace(
                a,
                -- ", Vån 11/11" / ", Våning 36" / ", lgh 1201" på slutet
                ',\s*(v\.|vån|våning|lgh|lägenhet)\.?\s*[0-9/\s-]*\s*[!?]*\s*$',
                '', 'i'),
            '\s*[!?]+\s*$', '')       -- utropstecken kvar på slutet
    ), '');
$$;;
