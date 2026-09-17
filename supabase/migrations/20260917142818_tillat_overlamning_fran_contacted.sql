-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- En gäst kan be om att få prata med en människa när som helst, också i sitt
-- allra första svar. Fram till 17 sep saknade 'contacted' och 'new' övergången
-- till 'handed_off', så vakten kastade ett undantag, hela uppdateringen rullades
-- tillbaka, och koden som inte kontrollerade felet gick vidare som om allt gått
-- bra. Kortet till Gustav hade då redan skickats. Resultatet: tre gäster den
-- 17 sep som Gustav fått SMS om men som aldrig hamnade i Överlämnad, och samtidigt
-- tappade samma uppdatering namn, telefon, sällskapsstorlek och chattens tillstånd.
create or replace function public.ce_valid_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
    SELECT CASE
        WHEN p_from = p_to THEN true
        -- opted_out är slutgiltigt: bara GDPR-radering rör leadet efter det
        WHEN p_from = 'opted_out' THEN false
        -- avfarter tillåtna från alla aktiva lägen
        WHEN p_to IN ('cold', 'nurture', 'opted_out') THEN true
        -- överlämning till människa är tillåten från varje aktivt läge: det är
        -- gästen som avgör när hon vill prata med Gustav, inte vår trappa
        WHEN p_to = 'handed_off' AND p_from IN ('new', 'contacted', 'in_conversation', 'qualifying', 'hot', 'booked') THEN true
        -- återupptagning
        WHEN p_from IN ('cold', 'nurture') AND p_to IN ('contacted', 'in_conversation', 'qualifying', 'hot') THEN true
        WHEN p_from = 'new'             AND p_to IN ('contacted', 'in_conversation') THEN true
        WHEN p_from = 'contacted'       AND p_to IN ('in_conversation', 'qualifying', 'hot') THEN true
        WHEN p_from = 'in_conversation' AND p_to IN ('qualifying', 'hot', 'handed_off') THEN true
        WHEN p_from = 'qualifying'      AND p_to IN ('in_conversation', 'hot', 'handed_off') THEN true
        WHEN p_from = 'hot'             AND p_to IN ('handed_off', 'booked', 'in_conversation') THEN true
        WHEN p_from = 'handed_off'      AND p_to IN ('booked', 'in_conversation', 'hot') THEN true
        WHEN p_from = 'booked'          AND p_to IN ('paid', 'handed_off') THEN true
        WHEN p_from = 'paid'            AND p_to IN ('booked') THEN true
        ELSE false
    END
$function$;
