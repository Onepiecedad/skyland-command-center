-- Två städningar efter att leadintaget blev flerkunds.
--
-- 1. Två Vinnie-kunder. Migrationen 20260917221000 skapade "Vinnie Sahlén"
--    (slug vinnie) utan att kolla att "Vinnie - All Gold Tattoo" (slug allgold)
--    redan fanns sedan 2026-08-12. All levande data ligger på den nya; den
--    gamla har bara prospekteringskontakten från Google Maps i juli, alltså
--    historiken om hur Vinnie blev kund. Den flyttas över, sedan tas det tomma
--    skalet bort. Kontakten är det enda som pekar på den — kontrollerat mot
--    samtliga femton främmande nycklar mot customers.
--
-- 2. Aktivitetsloggen stämplade allt som "cold-experience". Triggrarna skrevs
--    för CE men är generiska på tenant, så Vinnies händelser fick fel avsändare.
--    Etiketten hämtas nu ur tenants.slug. Bara den raden ändras i båda
--    funktionerna; logiken i övrigt är orörd (hämtad med pg_get_functiondef
--    2026-09-19).

-- ---------- 1. slå ihop kunderna ----------

update contacts
   set customer_id = '43369527-5c8b-45e5-aa9e-985d9bddda7f'
 where customer_id = 'ed0d15c8-9814-4f9a-a8bb-5fedb8bf4dfb';

delete from customers
 where id = 'ed0d15c8-9814-4f9a-a8bb-5fedb8bf4dfb'
   and not exists (select 1 from contacts      where customer_id = 'ed0d15c8-9814-4f9a-a8bb-5fedb8bf4dfb')
   and not exists (select 1 from opportunities where customer_id = 'ed0d15c8-9814-4f9a-a8bb-5fedb8bf4dfb')
   and not exists (select 1 from pipelines     where customer_id = 'ed0d15c8-9814-4f9a-a8bb-5fedb8bf4dfb');

-- ---------- 2. rätt agentetikett i aktivitetsloggen ----------

create or replace function public.ce_message_to_activity()
 returns trigger
 language plpgsql
as $function$
declare
  v_customer uuid;
  v_agent text;
  v_lead record;
begin
  v_customer := ce_customer_id(new.tenant_id);
  if v_customer is null then return new; end if;

  select slug into v_agent from tenants where id = new.tenant_id;

  select name, country into v_lead from ce_leads where id = new.lead_id;

  insert into activities (customer_id, agent, action, event_type, severity, autonomy_level, details, created_at)
  values (
    v_customer, coalesce(v_agent, 'okand'),
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
end $function$;

create or replace function public.ce_event_to_activity()
 returns trigger
 language plpgsql
as $function$
declare
  v_customer uuid;
  v_agent text;
  v_type text; v_action text; v_sev text; v_auto text;
  v_lead record;
begin
  v_customer := ce_customer_id(new.tenant_id);
  if v_customer is null then return new; end if;

  select slug into v_agent from tenants where id = new.tenant_id;

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
    v_customer, coalesce(v_agent, 'okand'), v_action, v_type, v_sev, v_auto,
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
end $function$;

-- Historiken är redan skriven med fel etikett. Rätta de rader som hör till en
-- annan tenant än cold-experience; CE:s egna rader är korrekta som de är.
update activities a
   set agent = t.slug
  from customers c
  join tenants t on t.id = c.tenant_id
 where a.customer_id = c.id
   and a.agent = 'cold-experience'
   and t.slug <> 'cold-experience';
