-- Rättelse. Systemet har redan en statusmodell (new, contacted, in_conversation,
-- qualifying, hot, handed_off, booked, paid, cold, nurture, opted_out) och en graf
-- över tillåtna övergångar i ce_valid_transition. Pipelinens steg är byggda mot den.
-- Första speglingen uppfann en egen mappning. Den här följer deras.

create or replace function ce_stage_for(p_status text, p_hot boolean)
returns text language sql immutable as $$
  select case
    when p_status in ('cold','nurture','opted_out','lost')      then 'Avböjt'
    when p_status = 'paid'                                      then 'Betald'
    when p_status = 'booked'                                    then 'Bokad'
    when p_status = 'handed_off'                                then 'Överlämnad'
    when p_status = 'hot'                                       then 'Het'
    -- Formulärleads som svarat ja stämplas med hot_at men behåller status 'new',
    -- eftersom new -> hot inte är en tillåten övergång. De hör ändå hemma i Het:
    -- det är Gustavs ringlista.
    when p_hot and p_status in ('new','contacted','in_conversation','qualifying') then 'Het'
    when p_status in ('contacted','in_conversation','qualifying') then 'Kvalificerad'
    else 'Ny'
  end;
$$;

create or replace function ce_status_for(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'Avböjt'       then 'cold'
    when 'Betald'       then 'paid'
    when 'Bokad'        then 'booked'
    when 'Överlämnad'   then 'handed_off'
    when 'Het'          then 'hot'
    when 'Kvalificerad' then 'in_conversation'
    else 'new'
  end;
$$;

-- Speglingen använder hot_at, inte intent, för att avgöra Het.
create or replace function ce_mirror_lead(p_lead_id uuid)
returns void language plpgsql as $$
declare
  l record; v_customer uuid; v_pipeline uuid; v_stage uuid; v_contact uuid;
  v_titel text; v_nyckel text; v_hot boolean;
begin
  select * into l from ce_lead_overview where id = p_lead_id;
  if not found then return; end if;

  select id into v_customer from customers where site_tenant_id = l.tenant_id limit 1;
  select id into v_pipeline from pipelines where name like 'Cold Experience%' limit 1;
  if v_customer is null or v_pipeline is null then return; end if;

  v_hot := l.hot_at is not null;
  v_nyckel := 'ce:' || l.id::text;
  select s.id into v_stage from stages s
    where s.pipeline_id = v_pipeline and s.name = ce_stage_for(l.status, v_hot) limit 1;

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
      'ce_callback', l.callback_window, 'ce_ad_name', l.ad_name, 'ce_status', l.status,
      'ce_form', (select qualification->'form' from ce_leads where id = l.id)
    ))
  )
  on conflict (dedupe_key) where dedupe_key is not null do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone,
    status = excluded.status, tags = excluded.tags, custom = excluded.custom,
    updated_at = now()
  returning id into v_contact;

  if v_contact is null then select id into v_contact from contacts where dedupe_key = v_nyckel; end if;
  if v_contact is null then return; end if;

  v_titel := coalesce(nullif(l.name,''), 'Okänt namn')
             || case when l.days is not null then ' · ' || l.days || ' dagar' else '' end;

  if exists (select 1 from opportunities where contact_id = v_contact and pipeline_id = v_pipeline) then
    update opportunities set stage_id = v_stage, title = v_titel,
      status = case when l.status='booked' then 'won'
                    when l.status in ('cold','lost','opted_out') then 'lost' else 'open' end,
      updated_at = now()
    where contact_id = v_contact and pipeline_id = v_pipeline;
  else
    insert into opportunities (contact_id, pipeline_id, stage_id, customer_id, tenant_id, title, status)
    values (v_contact, v_pipeline, v_stage, v_customer, l.tenant_id, v_titel,
            case when l.status='booked' then 'won'
                 when l.status in ('cold','lost','opted_out') then 'lost' else 'open' end);
  end if;
end $$;

-- Skrivning tillbaka, nu som BEFORE UPDATE så en otillåten flytt kan nekas snyggt
-- i stället för att kasta ett fel mitt i dra-och-släpp.
drop trigger if exists trg_ce_opp_writeback on opportunities;

create or replace function ce_opp_stage_writeback()
returns trigger language plpgsql as $$
declare v_lead uuid; v_steg text; v_ny text; v_nu text;
begin
  select (c.custom->>'ce_lead_id')::uuid into v_lead
    from contacts c where c.id = new.contact_id and c.dedupe_key like 'ce:%';
  if v_lead is null then return new; end if;

  select name into v_steg from stages where id = new.stage_id;
  if v_steg is null then return new; end if;

  v_ny := ce_status_for(v_steg);
  select status into v_nu from ce_leads where id = v_lead;

  if v_nu is not distinct from v_ny then return new; end if;

  -- Respektera systemets egen övergångsgraf. Är flytten otillåten snäpper
  -- kortet tillbaka i stället för att spränga uppdateringen.
  if not ce_valid_transition(v_nu, v_ny) then
    raise warning 'CE: otillåten flytt % -> % (lead %), kortet snappar tillbaka', v_nu, v_ny, v_lead;
    new.stage_id := old.stage_id;
    return new;
  end if;

  update ce_leads set status = v_ny, updated_at = now() where id = v_lead;
  insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
  select tenant_id, v_lead, 'status_changed', v_nu, v_ny, 'human',
         jsonb_build_object('via','crm-kanban','steg',v_steg)
  from ce_leads where id = v_lead;
  return new;
end $$;

create trigger trg_ce_opp_writeback
  before update of stage_id on opportunities
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function ce_opp_stage_writeback();;
