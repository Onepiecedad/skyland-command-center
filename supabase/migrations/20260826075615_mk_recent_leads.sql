-- Leadvyn: det mäklaren behöver se, inget mer. Raderade leads visas aldrig.
create or replace function public.mk_recent_leads(p_tenant uuid default null, p_limit integer default 25)
returns table (
    id uuid, name text, phone text, email text, intent text,
    listing_label text, broker_name text, callback_requested boolean,
    preferred_time text, message text, status text, consent_contact boolean,
    created_at timestamptz
)
language sql stable set search_path to 'public','pg_temp' as $$
    select l.id, l.name, l.phone, l.email, l.intent,
           nullif(concat_ws(', ',
             coalesce(mk_spoken_address(li.street_address), li.street_address), li.area), '') as listing_label,
           b.name as broker_name,
           l.callback_requested, l.preferred_time, l.message, l.status, l.consent_contact,
           l.created_at
    from mk_leads l
    left join mk_listings li on li.id = l.listing_id
    left join mk_brokers  b  on b.id = li.broker_id
    where l.tenant_id = coalesce(p_tenant, current_tenant_id())
      and l.erased_at is null
    order by l.created_at desc
    limit least(coalesce(p_limit, 25), 100);
$$;;
