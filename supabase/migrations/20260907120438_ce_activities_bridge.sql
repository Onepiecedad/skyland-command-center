-- Brygga: Cold Experience-händelser syns i SCC:s aktivitetsflöde under Gustavs kundkort.
-- Kopplingen går customers.site_tenant_id -> tenants.id -> ce_*.tenant_id.

create or replace function ce_customer_id(p_tenant uuid)
returns uuid language sql stable as $$
  select c.id from customers c where c.site_tenant_id = p_tenant limit 1;
$$;

-- Idempotens: varje bryggad rad bär sin källhändelses id. Ett unikt index gör
-- backfill och trigger ofarliga att köra om.
create unique index if not exists activities_ce_ref_uidx
  on activities ((details->>'ce_ref')) where details ? 'ce_ref';

create or replace function ce_event_to_activity()
returns trigger language plpgsql as $$
declare
  v_customer uuid;
  v_type text; v_action text; v_sev text; v_auto text;
  v_lead record;
begin
  v_customer := ce_customer_id(new.tenant_id);
  if v_customer is null then return new; end if;

  select name, country, status, channel into v_lead from ce_leads where id = new.lead_id;

  case new.event_type
    when 'form_received'    then v_type:='lead';        v_action:='ce.lead.form_received';  v_sev:='info';  v_auto:='OBSERVE';
    when 'lead_created'     then v_type:='lead';        v_action:='ce.lead.created';        v_sev:='info';  v_auto:='OBSERVE';
    when 'status_changed'   then v_type:='lead';        v_action:='ce.lead.status_changed'; v_sev:='info';  v_auto:='OBSERVE';
    when 'disqualified'     then v_type:='lead';        v_action:='ce.lead.disqualified';   v_sev:='info';  v_auto:='ACT';
    when 'first_email_sent' then v_type:='message';     v_action:='ce.email.sent';          v_sev:='info';  v_auto:='ACT';
    when 'owner_notified'   then v_type:='message';     v_action:='ce.owner.notified';      v_sev:='info';  v_auto:='ACT';
    when 'handoff'          then v_type:='opportunity'; v_action:='ce.lead.handoff';        v_sev:='warn';  v_auto:='ACT';
    when 'human_took_over'  then v_type:='chat';        v_action:='ce.human.took_over';     v_sev:='info';  v_auto:='OBSERVE';
    when 'agent_paused'     then v_type:='system';      v_action:='ce.agent.paused';        v_sev:='warn';  v_auto:='OBSERVE';
    when 'agent_error'      then v_type:='system';      v_action:='ce.agent.error';         v_sev:='error'; v_auto:='OBSERVE';
    else                         v_type:='system';      v_action:='ce.'||new.event_type;    v_sev:='info';  v_auto:='OBSERVE';
  end case;

  insert into activities (customer_id, agent, action, event_type, severity, autonomy_level, details, created_at)
  values (
    v_customer, 'cold-experience', v_action, v_type, v_sev, v_auto,
    jsonb_strip_nulls(jsonb_build_object(
      'ce_ref',   'event:'||new.id::text,
      'lead_id',  new.lead_id,
      'lead',     v_lead.name,
      'country',  v_lead.country,
      'channel',  v_lead.channel,
      'from_status', new.from_status,
      'to_status',   new.to_status,
      'actor',    new.actor,
      'payload',  new.payload
    )),
    new.created_at
  )
  on conflict do nothing;

  return new;
end $$;

create or replace function ce_message_to_activity()
returns trigger language plpgsql as $$
declare
  v_customer uuid;
  v_lead record;
begin
  v_customer := ce_customer_id(new.tenant_id);
  if v_customer is null then return new; end if;

  select name, country into v_lead from ce_leads where id = new.lead_id;

  insert into activities (customer_id, agent, action, event_type, severity, autonomy_level, details, created_at)
  values (
    v_customer, 'cold-experience',
    'ce.message.'||new.direction,
    'message',
    case when new.status = 'failed' then 'error' else 'info' end,
    case when new.direction = 'outbound' then 'ACT' else 'OBSERVE' end,
    jsonb_strip_nulls(jsonb_build_object(
      'ce_ref',  'msg:'||new.id::text,
      'lead_id', new.lead_id,
      'lead',    v_lead.name,
      'country', v_lead.country,
      'channel', new.channel,
      'sender',  new.sender,
      'status',  new.status,
      'preview', left(coalesce(new.body,''), 200),
      'conversation_id', new.conversation_id
    )),
    new.created_at
  )
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_ce_events_to_activities on ce_lead_events;
create trigger trg_ce_events_to_activities
  after insert on ce_lead_events
  for each row execute function ce_event_to_activity();

drop trigger if exists trg_ce_msg_to_activities on ce_messages;
create trigger trg_ce_msg_to_activities
  after insert on ce_messages
  for each row execute function ce_message_to_activity();

comment on function ce_event_to_activity is
  'Speglar ce_lead_events till activities så Cold Experience syns i SCC:s kundvy. details->>ce_ref gör den idempotent.';;
