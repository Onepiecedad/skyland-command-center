-- GDPR: leads raderas aldrig (händelseloggen är append-only) — de anonymiseras.
-- Samma mönster som ce_erase_lead.
create or replace function public.mk_erase_lead(p_lead_id uuid, p_reason text default 'gdpr_request')
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_tenant uuid;
begin
    select tenant_id into v_tenant from mk_leads where id = p_lead_id;
    if not found then
        raise exception 'Okänt lead %', p_lead_id;
    end if;

    update mk_leads
       set name = null, phone = null, email = null, message = null,
           preferred_time = null, external_call_id = null,
           qualification = '{}'::jsonb, dedupe_key = null,
           erased_at = now()
     where id = p_lead_id;

    insert into mk_lead_events (tenant_id, lead_id, event_type, payload)
    values (v_tenant, p_lead_id, 'erased',
            jsonb_build_object('reason', p_reason,
                               'actor', coalesce(current_setting('app.actor', true), 'system')));
end $$;

create or replace function public.mk_opt_out(p_lead_id uuid, p_reason text default 'user_request')
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_tenant uuid;
begin
    select tenant_id into v_tenant from mk_leads where id = p_lead_id;
    if not found then
        raise exception 'Okänt lead %', p_lead_id;
    end if;

    update mk_leads
       set opted_out_at = now(), consent_contact = false, callback_requested = false,
           status = 'forlorad'
     where id = p_lead_id;

    insert into mk_lead_events (tenant_id, lead_id, event_type, payload)
    values (v_tenant, p_lead_id, 'opt_out', jsonb_build_object('reason', p_reason));
end $$;

-- Testrader från utvecklingen städas bort en gång; guarden sätts tillbaka direkt efteråt.
alter table public.mk_lead_events disable trigger mk_lead_events_append_only;
delete from public.mk_lead_events where lead_id in (select id from public.mk_leads where external_call_id like 'conv\_test\_%' or name = 'Test Testsson');
delete from public.mk_leads where external_call_id like 'conv\_test\_%' or name = 'Test Testsson';
alter table public.mk_lead_events enable trigger mk_lead_events_append_only;;
