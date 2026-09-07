-- En språkmodell som anropar verktyget för tidigt fyller fälten med beskrivningen av
-- fältet: name="Användarens namn", phone="Användarens telefonnummer". Ett sådant lead är
-- värre än inget — det ser ut som data. Endpointen måste vägra, inte prompten.

create or replace function public.mk_is_placeholder(v text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
    select v is null
        or btrim(v) = ''
        or lower(btrim(v)) ~ '^(användarens?|anvandarens?|kundens?|kund|user|customer)\s*(namn|name|telefonnummer|telefon|nummer|phone|e-?post|email|mejl)?$'
        or lower(btrim(v)) ~ '^(namn|name|telefon|telefonnummer|nummer|phone|e-?post|email|mejl|okänt|okänd|unknown|n/?a|saknas|null|none|xxx+|test)$'
        or lower(btrim(v)) ~ '^(ditt|din|ert|er)\s'
        or btrim(v) ~ '^[<\[{].*[>\]}]$';
$$;

create or replace function public.mk_valid_phone(v text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
    select v is not null
       and not mk_is_placeholder(v)
       and length(regexp_replace(v, '[^0-9]', '', 'g')) between 7 and 15;
$$;

create or replace function public.mk_valid_email(v text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
    select v is not null and not mk_is_placeholder(v) and v ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
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
    v_key   text;
    v_id    uuid;
    v_name  text;
    v_phone text;
    v_mail  text;
begin
    -- Städa bort platshållare innan något sparas
    v_name  := case when mk_is_placeholder(p_name)  then null else btrim(p_name)  end;
    v_phone := case when mk_valid_phone(p_phone)    then btrim(p_phone) else null end;
    v_mail  := case when mk_valid_email(p_email)    then lower(btrim(p_email)) else null end;

    -- Utan en väg att nå kunden är leadet värdelöst. Vägra, så att agenten
    -- tvingas fråga i stället för att lova en återkoppling som aldrig kan ske.
    if v_phone is null and v_mail is null then
        return null;
    end if;

    v_key := nullif(lower(coalesce(regexp_replace(coalesce(v_phone,''), '[^0-9+]', '', 'g'), '') ||
                          coalesce(v_mail,'')), '');

    insert into mk_leads (tenant_id, name, phone, email, intent, listing_id, viewing_id,
                          callback_requested, preferred_time, message, source,
                          external_call_id, consent_contact, dedupe_key)
    values (p_tenant, v_name, v_phone, v_mail, p_intent, p_listing_id, p_viewing_id,
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
end $$;

-- Städa bort skräpleadet från testet
alter table public.mk_lead_events disable trigger mk_lead_events_append_only;
delete from public.mk_lead_events where lead_id in (
    select id from public.mk_leads where mk_is_placeholder(name) or not mk_valid_phone(phone));
delete from public.mk_leads where mk_is_placeholder(name) or not mk_valid_phone(phone);
alter table public.mk_lead_events enable trigger mk_lead_events_append_only;;
