-- Röstvänlig sammanfattning: svenskt tusentalsmellanrum, och status sägs bara när den avviker.
create or replace function public.mk_kr(n numeric)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select case when n is null then null
                else replace(to_char(round(n), 'FM999G999G999'), ',', ' ') end;
$$;

create or replace function public.mk_listing_summary(l public.mk_listings)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select concat_ws(', ',
        nullif(trim(concat_ws(' ',
            coalesce(l.object_type, 'bostad'),
            case when l.street_address is not null then 'på ' || l.street_address end)), ''),
        nullif(l.area, ''),
        case when l.rooms is not null then trim(to_char(l.rooms, 'FM999D9')) || ' rum' end,
        case when l.living_area is not null then trim(to_char(l.living_area, 'FM999D9')) || ' kvadratmeter' end,
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
