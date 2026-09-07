-- Mäklare stoppar in säljtext i adressfältet: "Virvelvindsgatan 30, Vån 11/11!".
-- En röstagent läser upp det bokstavligt — "vån elva snedstreck elva utropstecken".
-- Adressen i databasen lämnas orörd (den behövs för matchning mot Vitec); det är bara
-- den uppläsbara sammanfattningen som städas.
create or replace function public.mk_spoken_address(a text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select nullif(trim(regexp_replace(
        -- allt efter första kommat är tillägg, inte adress
        split_part(a, ',', 1),
        '\s*[!?]+\s*$', ''            -- utropstecken på slutet
    )), '');
$$;

create or replace function public.mk_listing_summary(l public.mk_listings)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select concat_ws(', ',
        nullif(trim(concat_ws(' ',
            coalesce(l.object_type, 'bostad'),
            case when l.street_address is not null
                 then 'på ' || coalesce(mk_spoken_address(l.street_address), l.street_address) end)), ''),
        nullif(l.area, ''),
        case when l.rooms is not null then mk_num(l.rooms) || ' rum' end,
        case when l.living_area is not null then mk_num(l.living_area) || ' kvadratmeter' end,
        case when l.price is not null then mk_kr(l.price) || ' kronor' end,
        case when l.monthly_fee is not null then 'avgift ' || mk_kr(l.monthly_fee) || ' kronor i månaden' end,
        case l.status
            when 'budgivning' then 'budgivning pågår'
            when 'kommande'   then 'kommande objekt'
            when 'såld'       then 'såld'
            when 'avtal'      then 'under avtal'
            else null
        end
    );
$$;;
