drop function if exists public.mk_search_listings(uuid,text,text,text,numeric,numeric,numeric,text,integer);

create function public.mk_search_listings(
    p_tenant           uuid    default null,
    p_query            text    default null,
    p_area             text    default null,
    p_object_type      text    default null,
    p_min_rooms        numeric default null,
    p_max_price        numeric default null,
    p_min_living_area  numeric default null,
    p_status           text    default null,
    p_limit            integer default 5
)
returns table (
    id uuid, headline text, street_address text, area text, municipality text,
    object_type text, status text, price numeric, monthly_fee numeric,
    rooms numeric, living_area numeric, build_year integer,
    source_url text, broker_name text, next_viewing timestamptz, summary text,
    total_matches bigint
)
language sql stable set search_path to 'public','pg_temp' as $$
    with matchande as (
        select l.id, l.headline, l.street_address, l.area, l.municipality,
               l.object_type, l.status, l.price, l.monthly_fee,
               l.rooms, l.living_area, l.build_year, l.source_url,
               b.name as broker_name,
               (select min(v.starts_at) from mk_viewings v
                 where v.listing_id = l.id and v.starts_at > now()) as next_viewing,
               mk_listing_summary(l) as summary,
               count(*) over () as total_matches
        from mk_listings l
        left join mk_brokers b on b.id = l.broker_id
        where l.tenant_id = coalesce(p_tenant, current_tenant_id())
          and (
                p_status is null      and l.status in ('till_salu','budgivning')
             or p_status = 'alla'
             or p_status is not null and p_status <> 'alla' and l.status = p_status
              )
          and (p_area is null or l.area ilike '%' || p_area || '%' or l.municipality ilike '%' || p_area || '%')
          and (p_object_type is null or l.object_type ilike p_object_type)
          and (p_min_rooms is null or l.rooms >= p_min_rooms)
          and (p_max_price is null or l.price <= p_max_price)
          and (p_min_living_area is null or l.living_area >= p_min_living_area)
          and (p_query is null or to_tsvector('swedish',
                 coalesce(l.headline,'') || ' ' || coalesce(l.street_address,'') || ' ' ||
                 coalesce(l.area,'') || ' ' || coalesce(l.municipality,'') || ' ' || coalesce(l.description,''))
               @@ plainto_tsquery('swedish', p_query))
    )
    select id, headline, street_address, area, municipality,
           object_type, status, price, monthly_fee,
           rooms, living_area, build_year,
           source_url, broker_name, next_viewing, summary, total_matches
    from matchande
    -- budgivning först: mest akut för en spekulant. Sen billigast först.
    order by (status = 'budgivning') desc, price nulls last
    limit least(coalesce(p_limit, 5), 25);
$$;;
