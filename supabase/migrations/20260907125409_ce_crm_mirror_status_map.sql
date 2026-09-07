-- contacts.status tillåter bara new/working/qualified/won/lost. Cold Experience har
-- fler lägen, så vi mappar in i deras vokabulär i stället för att ändra deras tabell.
create or replace function ce_contact_status_for(p_status text)
returns text language sql immutable as $$
  select case p_status
    when 'new'             then 'new'
    when 'in_conversation' then 'working'
    when 'qualifying'      then 'working'
    when 'handed_off'      then 'qualified'
    when 'booked'          then 'won'
    when 'paid'            then 'won'
    when 'cold'            then 'lost'
    when 'lost'            then 'lost'
    else 'new'
  end;
$$;

create or replace function ce_mirror_lead(p_lead_id uuid)
returns void language plpgsql as $$
declare
  l record; v_customer uuid; v_pipeline uuid; v_stage uuid; v_contact uuid;
  v_intent text; v_titel text; v_nyckel text;
begin
  select * into l from ce_lead_overview where id = p_lead_id;
  if not found then return; end if;

  select id into v_customer from customers where site_tenant_id = l.tenant_id limit 1;
  select id into v_pipeline from pipelines where name like 'Cold Experience%' limit 1;
  if v_customer is null or v_pipeline is null then return; end if;

  v_intent := coalesce(l.intent, 'unknown');
  v_nyckel := 'ce:' || l.id::text;
  select id into v_stage from stages
    where pipeline_id = v_pipeline and name = ce_stage_for(l.status, v_intent) limit 1;

  insert into contacts (customer_id, tenant_id, name, email, phone, source, status, dedupe_key, tags, custom)
  values (
    v_customer, l.tenant_id,
    coalesce(nullif(l.name,''), 'Okänt namn'), l.email, l.phone,
    'cold_experience', ce_contact_status_for(l.status), v_nyckel,
    array_remove(array[
      'cold-experience',
      case when l.country is not null then 'land:'  || lower(l.country) end,
      case when l.channel is not null then 'kanal:' || l.channel end,
      case when l.intent  is not null then 'vill:'  || l.intent end,
      case when not l.answered then 'obesvarad' end
    ], null),
    jsonb_strip_nulls(jsonb_build_object(
      'ce_lead_id', l.id, 'ce_channel', l.channel, 'ce_intent', l.intent,
      'ce_country', l.country, 'ce_message', l.guest_message,
      'ce_last_inbound', l.last_inbound_body, 'ce_received_at', l.received_at,
      'ce_answered', l.answered, 'ce_messages_in', l.messages_in, 'ce_messages_out', l.messages_out,
      'ce_travel_when', l.travel_when, 'ce_days', l.days, 'ce_adults', l.adults,
      'ce_departure', l.departure, 'ce_price_eur', l.price_quoted_eur,
      'ce_callback', l.callback_window, 'ce_ad_name', l.ad_name,
      'ce_status', l.status,
      'ce_form', (select qualification->'form' from ce_leads where id = l.id)
    ))
  )
  on conflict (dedupe_key) where dedupe_key is not null do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone,
    status = excluded.status, tags = excluded.tags, custom = excluded.custom,
    updated_at = now()
  returning id into v_contact;

  if v_contact is null then
    select id into v_contact from contacts where dedupe_key = v_nyckel;
  end if;
  if v_contact is null then return; end if;

  v_titel := coalesce(nullif(l.name,''), 'Okänt namn')
             || case when l.days is not null then ' · ' || l.days || ' dagar' else '' end;

  if exists (select 1 from opportunities where contact_id = v_contact and pipeline_id = v_pipeline) then
    update opportunities set
      stage_id = v_stage, title = v_titel,
      status = case when l.status='booked' then 'won'
                    when l.status in ('cold','lost') then 'lost' else 'open' end,
      updated_at = now()
    where contact_id = v_contact and pipeline_id = v_pipeline;
  else
    insert into opportunities (contact_id, pipeline_id, stage_id, customer_id, tenant_id, title, status)
    values (v_contact, v_pipeline, v_stage, v_customer, l.tenant_id, v_titel,
            case when l.status='booked' then 'won'
                 when l.status in ('cold','lost') then 'lost' else 'open' end);
  end if;
end $$;;
