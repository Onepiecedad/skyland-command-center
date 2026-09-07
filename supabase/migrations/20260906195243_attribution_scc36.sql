alter table bookings
    add column if not exists attributed_message_id uuid references messages(id) on delete set null,
    add column if not exists attributed_enrollment_id uuid references sequence_enrollments(id) on delete set null,
    add column if not exists attributed_touch_at timestamptz,
    add column if not exists attribution_note text,
    add column if not exists paid_confirmed_at timestamptz,
    add column if not exists paid_value_sek numeric,
    add column if not exists commission_sek numeric;

comment on column bookings.attributed_message_id is 'Senaste utgående meddelande till kontakten inom 90 dagar före bokningen (SCC-36)';
comment on column bookings.paid_confirmed_at is 'Operatören har bekräftat att bokningen blev betald/genomförd — provisionsgrundande (SCC-39)';

create index if not exists bookings_attributed_enrollment_idx on bookings (attributed_enrollment_id);
create index if not exists bookings_customer_created_idx on bookings (customer_id, created_at desc);

create or replace view v_outreach_funnel as
select
    e.id                                   as enrollment_id,
    e.sequence_id,
    s.name                                 as sequence_name,
    e.contact_id,
    c.name                                 as contact_name,
    c.customer_id,
    c.tenant_id,
    c.source,
    c.custom->>'area'                      as area,
    c.custom->>'dm_vertical'               as dm_vertical,
    c.custom->>'dm_variant'                as dm_variant,
    nullif(c.custom->>'score', '')::numeric             as score,
    nullif(c.custom->>'research_cost_usd', '')::numeric as research_cost_usd,
    e.enrolled_at,
    e.status                               as enrollment_status,
    e.exit_reason,
    e.current_position,
    (select count(*) from messages m
      where m.direction = 'outbound' and m.status = 'sent'
        and m.metadata->>'enrollment_id' = e.id::text)                       as sent_count,
    (select min(m.created_at) from messages m
      where m.direction = 'outbound' and m.status = 'sent'
        and m.metadata->>'enrollment_id' = e.id::text)                       as first_sent_at,
    (select count(*) from messages m
      where m.direction = 'inbound'
        and m.metadata->>'contact_id' = e.contact_id::text
        and m.created_at >= e.enrolled_at)                                    as reply_count,
    (select a.details->>'intent' from activities a
      where a.action like 'reply.classified%'
        and a.details->>'contact_id' = e.contact_id::text
        and a.created_at >= e.enrolled_at
      order by a.created_at desc limit 1)                                     as reply_intent,
    (select count(*) from bookings b
      where b.contact_id = e.contact_id
        and b.created_at >= e.enrolled_at
        and b.status <> 'cancelled')                                          as booking_count,
    (select min(b.created_at) from bookings b
      where b.contact_id = e.contact_id
        and b.created_at >= e.enrolled_at
        and b.status <> 'cancelled')                                          as first_booking_at,
    o.status                               as opportunity_status,
    st.name                                as stage_name,
    o.value_sek
from sequence_enrollments e
join contacts c   on c.id = e.contact_id
join sequences s  on s.id = e.sequence_id
left join lateral (
    select o.* from opportunities o
     where o.contact_id = e.contact_id
     order by o.created_at desc limit 1
) o on true
left join stages st on st.id = o.stage_id;

comment on view v_outreach_funnel is 'SCC-36: en rad per enrollment — dimensioner + utfall. Läses av /api/v1/attribution/outreach.';;
