-- Leadöversikt för SCC. En rad per lead med allt listan behöver, joins gjorda i SQL
-- i stället för i klienten. Ingen SECURITY DEFINER: vyn ärver anroparens rättigheter.
create or replace view ce_lead_overview as
select
  l.id,
  l.tenant_id,
  l.name,
  l.country,
  l.channel,
  l.source,
  l.status,
  l.phone,
  l.email,
  l.language,
  l.qualification->>'winter_intent'            as intent,
  l.custom->>'priority'                        as priority,
  nullif(trim(l.qualification->>'message'),'') as guest_message,
  l.hot_reasons,
  l.notes,
  l.group_size,
  l.budget_signal,
  -- chattens kvalificering, om agenten hunnit fylla i något
  l.qualification->'chat'->>'travel_when'      as travel_when,
  (l.qualification->'chat'->>'days')::int      as days,
  (l.qualification->'chat'->>'adults')::int    as adults,
  l.qualification->'chat'->>'departure'        as departure,
  (l.qualification->'chat'->>'price_quoted_eur')::numeric as price_quoted_eur,
  l.qualification->'chat'->>'callback_window'  as callback_window,
  -- annonsen leadet kom från
  l.ad_referral->>'ad_name'                    as ad_name,
  l.ad_referral->>'campaign_name'              as campaign_name,
  -- tidslinje
  coalesce((l.custom->>'meta_created_time')::timestamptz, l.created_at) as received_at,
  l.created_at,
  l.first_contact_at,
  l.hot_at,
  l.handed_off_at,
  l.booked_at,
  l.opted_out_at,
  l.erased_at,
  -- konversationen
  c.id                                         as conversation_id,
  c.last_inbound_at,
  c.last_outbound_at,
  c.human_active,
  c.free_entry_expires_at,
  coalesce(m.in_count, 0)                      as messages_in,
  coalesce(m.out_count, 0)                     as messages_out,
  (coalesce(m.out_count, 0) > 0)               as answered,
  m.last_message_at,
  m.last_inbound_body
from ce_leads l
left join lateral (
  select cv.* from ce_conversations cv
  where cv.lead_id = l.id order by cv.created_at desc limit 1
) c on true
left join lateral (
  select
    count(*) filter (where ms.direction = 'inbound')  as in_count,
    count(*) filter (where ms.direction = 'outbound' and ms.status = 'sent') as out_count,
    max(ms.created_at) as last_message_at,
    (array_agg(ms.body order by ms.created_at desc)
       filter (where ms.direction = 'inbound'))[1] as last_inbound_body
  from ce_messages ms where ms.lead_id = l.id
) m on true
where l.erased_at is null;

comment on view ce_lead_overview is
  'En rad per Cold Experience-lead med konversationsstatus. Används av SCC:s leadvy.';;
