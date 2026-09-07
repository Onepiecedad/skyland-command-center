-- Verktygsfunktioner för röstagenten. Anropas med service role från edge function,
-- eller med tenant-JWT via PostgREST (då gäller RLS och p_tenant defaultar till current_tenant_id()).

create or replace function public.mk_listing_summary(l public.mk_listings)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
    select concat_ws(', ',
        nullif(concat_ws(' ', l.object_type, 'på', l.street_address), ''),
        nullif(l.area, ''),
        case when l.rooms is not null then l.rooms::text || ' rum' end,
        case when l.living_area is not null then l.living_area::text || ' kvm' end,
        case when l.price is not null then to_char(l.price, 'FM999G999G999') || ' kr' end,
        case when l.monthly_fee is not null then 'avgift ' || to_char(l.monthly_fee, 'FM999G999') || ' kr/mån' end,
        nullif(l.status, '')
    );
$$;

create or replace function public.mk_search_listings(
    p_tenant           uuid    default null,
    p_query            text    default null,
    p_area             text    default null,
    p_object_type      text    default null,
    p_min_rooms        numeric default null,
    p_max_price        numeric default null,
    p_min_living_area  numeric default null,
    p_status           text    default 'till_salu',
    p_limit            integer default 5
)
returns table (
    id uuid, headline text, street_address text, area text, municipality text,
    object_type text, status text, price numeric, monthly_fee numeric,
    rooms numeric, living_area numeric, build_year integer,
    source_url text, broker_name text, next_viewing timestamptz, summary text
)
language sql stable set search_path to 'public','pg_temp' as $$
    select l.id, l.headline, l.street_address, l.area, l.municipality,
           l.object_type, l.status, l.price, l.monthly_fee,
           l.rooms, l.living_area, l.build_year,
           l.source_url, b.name,
           (select min(v.starts_at) from mk_viewings v
             where v.listing_id = l.id and v.starts_at > now()),
           mk_listing_summary(l)
    from mk_listings l
    left join mk_brokers b on b.id = l.broker_id
    where l.tenant_id = coalesce(p_tenant, current_tenant_id())
      and (p_status is null or l.status = p_status)
      and (p_area is null or l.area ilike '%' || p_area || '%' or l.municipality ilike '%' || p_area || '%')
      and (p_object_type is null or l.object_type ilike p_object_type)
      and (p_min_rooms is null or l.rooms >= p_min_rooms)
      and (p_max_price is null or l.price <= p_max_price)
      and (p_min_living_area is null or l.living_area >= p_min_living_area)
      and (p_query is null or to_tsvector('swedish',
             coalesce(l.headline,'') || ' ' || coalesce(l.street_address,'') || ' ' ||
             coalesce(l.area,'') || ' ' || coalesce(l.municipality,'') || ' ' || coalesce(l.description,''))
           @@ plainto_tsquery('swedish', p_query))
    order by l.price nulls last
    limit least(coalesce(p_limit, 5), 25);
$$;

create or replace function public.mk_get_listing(p_listing_id uuid, p_tenant uuid default null)
returns table (
    id uuid, headline text, street_address text, area text, municipality text, postal_code text,
    object_type text, tenure text, status text, price numeric, monthly_fee numeric, operating_cost numeric,
    rooms numeric, living_area numeric, supplementary_area numeric, plot_area numeric,
    floor text, elevator boolean, balcony boolean, build_year integer, energy_class text,
    association text, description text, source_url text,
    broker_name text, broker_phone text, broker_email text,
    viewings jsonb, summary text
)
language sql stable set search_path to 'public','pg_temp' as $$
    select l.id, l.headline, l.street_address, l.area, l.municipality, l.postal_code,
           l.object_type, l.tenure, l.status, l.price, l.monthly_fee, l.operating_cost,
           l.rooms, l.living_area, l.supplementary_area, l.plot_area,
           l.floor, l.elevator, l.balcony, l.build_year, l.energy_class,
           l.association, l.description, l.source_url,
           b.name, b.phone, b.email,
           coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'starts_at', v.starts_at,
                                                         'ends_at', v.ends_at, 'type', v.viewing_type)
                                      order by v.starts_at)
                     from mk_viewings v where v.listing_id = l.id and v.starts_at > now()), '[]'::jsonb),
           mk_listing_summary(l)
    from mk_listings l
    left join mk_brokers b on b.id = l.broker_id
    where l.id = p_listing_id
      and l.tenant_id = coalesce(p_tenant, current_tenant_id());
$$;

create or replace function public.mk_upcoming_viewings(
    p_tenant uuid default null, p_listing_id uuid default null, p_limit integer default 10
)
returns table (id uuid, listing_id uuid, street_address text, area text,
               starts_at timestamptz, ends_at timestamptz, viewing_type text)
language sql stable set search_path to 'public','pg_temp' as $$
    select v.id, v.listing_id, l.street_address, l.area, v.starts_at, v.ends_at, v.viewing_type
    from mk_viewings v join mk_listings l on l.id = v.listing_id
    where v.tenant_id = coalesce(p_tenant, current_tenant_id())
      and (p_listing_id is null or v.listing_id = p_listing_id)
      and v.starts_at > now()
    order by v.starts_at
    limit least(coalesce(p_limit, 10), 50);
$$;

create or replace function public.match_mk_documents(
    query_embedding vector(1536),
    p_tenant uuid default null,
    match_threshold double precision default 0.5,
    match_count integer default 5
)
returns table (id uuid, title text, content text, category text,
               source_url text, metadata jsonb, similarity double precision)
language sql stable set search_path to 'public','pg_temp' as $$
    select d.id, d.title, d.content, d.category, d.source_url, d.metadata,
           1 - (d.embedding <=> query_embedding)
    from mk_documents d
    where d.tenant_id = coalesce(p_tenant, current_tenant_id())
      and d.embedding is not null
      and 1 - (d.embedding <=> query_embedding) > match_threshold
    order by d.embedding <=> query_embedding
    limit least(coalesce(match_count, 5), 20);
$$;

create or replace function public.mk_capture_lead(
    p_tenant uuid,
    p_name text default null,
    p_phone text default null,
    p_email text default null,
    p_intent text default 'ovrigt',
    p_listing_id uuid default null,
    p_viewing_id uuid default null,
    p_callback boolean default false,
    p_preferred_time text default null,
    p_message text default null,
    p_source text default 'voice',
    p_external_call_id text default null,
    p_consent boolean default false
)
returns uuid language plpgsql set search_path to 'public','pg_temp' as $$
declare
    v_key text;
    v_id  uuid;
begin
    v_key := nullif(lower(coalesce(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '') ||
                          coalesce(p_email,'')), '');

    insert into mk_leads (tenant_id, name, phone, email, intent, listing_id, viewing_id,
                          callback_requested, preferred_time, message, source,
                          external_call_id, consent_contact, dedupe_key)
    values (p_tenant, p_name, p_phone, p_email, p_intent, p_listing_id, p_viewing_id,
            p_callback, p_preferred_time, p_message, p_source,
            p_external_call_id, p_consent, v_key)
    on conflict (tenant_id, dedupe_key) where dedupe_key is not null
    do update set
        name           = coalesce(excluded.name, mk_leads.name),
        email          = coalesce(excluded.email, mk_leads.email),
        phone          = coalesce(excluded.phone, mk_leads.phone),
        intent         = excluded.intent,
        listing_id     = coalesce(excluded.listing_id, mk_leads.listing_id),
        viewing_id     = coalesce(excluded.viewing_id, mk_leads.viewing_id),
        callback_requested = mk_leads.callback_requested or excluded.callback_requested,
        preferred_time = coalesce(excluded.preferred_time, mk_leads.preferred_time),
        message        = concat_ws(E'\n---\n', mk_leads.message, excluded.message),
        consent_contact = mk_leads.consent_contact or excluded.consent_contact,
        updated_at     = now()
    returning id into v_id;

    return v_id;
end $$;;
