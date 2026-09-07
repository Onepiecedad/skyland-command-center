-- RLS: anon nekas helt, authenticated ser bara sin tenant. Service role (n8n/edge) går förbi RLS.
do $$
declare t text;
begin
  foreach t in array array['mk_brokers','mk_listings','mk_viewings','mk_documents','mk_crawl_pages','mk_leads','mk_lead_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists deny_all_anon_%1$s on public.%1$I', t);
    execute format('create policy deny_all_anon_%1$s on public.%1$I as permissive for all to anon using (false)', t);
    execute format('drop policy if exists tenant_isolation_%1$s on public.%1$I', t);
    execute format('create policy tenant_isolation_%1$s on public.%1$I as permissive for all to authenticated using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())', t);
  end loop;
end $$;

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['mk_brokers','mk_listings','mk_viewings','mk_crawl_pages','mk_leads']
  loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$I', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- mk_lead_events är append-only
create or replace function public.mk_events_append_only()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
    raise exception 'mk_lead_events är append-only';
end $$;

drop trigger if exists mk_lead_events_append_only on public.mk_lead_events;
create trigger mk_lead_events_append_only
    before update or delete on public.mk_lead_events
    for each row execute function public.mk_events_append_only();

-- statuslogg för leads
create or replace function public.mk_leads_status_log()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
    if tg_op = 'INSERT' then
        insert into public.mk_lead_events (tenant_id, lead_id, event_type, to_status, payload)
        values (new.tenant_id, new.id, 'created', new.status,
                jsonb_build_object('source', new.source, 'intent', new.intent, 'listing_id', new.listing_id));
    elsif new.status is distinct from old.status then
        insert into public.mk_lead_events (tenant_id, lead_id, event_type, from_status, to_status)
        values (new.tenant_id, new.id, 'status_change', old.status, new.status);
    end if;
    return new;
end $$;

drop trigger if exists mk_leads_status_log on public.mk_leads;
create trigger mk_leads_status_log
    after insert or update on public.mk_leads
    for each row execute function public.mk_leads_status_log();;
