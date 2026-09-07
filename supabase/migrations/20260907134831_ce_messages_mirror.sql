-- Speglar ce_messages till messages så den befintliga ConversationInbox visar
-- tråden. Kopplingen till kontakten går via metadata->>'contact_id', samma väg
-- som de befintliga meddelandena använder.

create unique index if not exists messages_ce_ref_uidx
  on messages ((metadata->>'ce_message_id')) where metadata ? 'ce_message_id';

create or replace function ce_mirror_message(p_msg_id uuid)
returns void language plpgsql as $$
declare m record; v_contact uuid; v_customer uuid;
begin
  select * into m from ce_messages where id = p_msg_id;
  if not found or m.lead_id is null then return; end if;

  select c.id, c.customer_id into v_contact, v_customer
    from contacts c where c.dedupe_key = 'ce:' || m.lead_id::text;
  if v_contact is null then return; end if;

  insert into messages (customer_id, conversation_id, role, channel, direction,
                        content, status, provider_message_id, metadata, created_at)
  values (
    v_customer, m.conversation_id,
    case when m.direction = 'inbound' then 'user' else 'assistant' end,
    m.channel, m.direction,
    coalesce(m.body, ''), m.status, m.external_id,
    jsonb_build_object(
      'contact_id',    v_contact,
      'ce_message_id', m.id,
      'ce_lead_id',    m.lead_id,
      'sender',        m.sender
    ),
    m.created_at
  )
  on conflict ((metadata->>'ce_message_id')) where metadata ? 'ce_message_id'
  do update set content = excluded.content, status = excluded.status, metadata = excluded.metadata;
end $$;

create or replace function ce_msg_mirror_trg()
returns trigger language plpgsql as $$
begin
  if new.lead_id is not null then
    perform ce_mirror_lead(new.lead_id);   -- kortet: obesvarad, antal
    perform ce_mirror_message(new.id);     -- tråden
  end if;
  return new;
end $$;

comment on function ce_mirror_message is
  'Projicerar ett ce_messages-rad till messages så ConversationInbox hittar den. Idempotent på metadata->>ce_message_id.';;
