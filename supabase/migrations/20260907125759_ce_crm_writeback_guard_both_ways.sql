-- Flaggan skyddade bara ena riktningen. Tillbakaskrivningen uppdaterade ce_leads,
-- vilket väckte speglingen, som ville röra samma opportunities-rad som just då
-- uppdaterades i en BEFORE-trigger. Nu tystar flaggan speglingen åt båda håll,
-- och kortets nya läge sätts ändå av new.stage_id som användaren valde.

create or replace function ce_leads_mirror_trg()
returns trigger language plpgsql as $$
begin
  if ce_mirroring() then return new; end if;
  perform ce_mirror_lead(new.id);
  return new;
end $$;

create or replace function ce_opp_stage_writeback()
returns trigger language plpgsql as $$
declare
  v_lead uuid; v_steg text; v_mal text; v_nu text; v_via text; v_forra text;
  KANDIDATER text[] := array['contacted','in_conversation','qualifying','hot','handed_off'];
begin
  if ce_mirroring() then return new; end if;

  select (c.custom->>'ce_lead_id')::uuid into v_lead
    from contacts c where c.id = new.contact_id and c.dedupe_key like 'ce:%';
  if v_lead is null then return new; end if;

  select name into v_steg from stages where id = new.stage_id;
  if v_steg is null then return new; end if;

  v_mal := ce_status_for(v_steg);
  select status into v_nu from ce_leads where id = v_lead;
  if v_nu is not distinct from v_mal then return new; end if;

  if not ce_valid_transition(v_nu, v_mal) then
    select k into v_via from unnest(KANDIDATER) k
     where k <> v_nu and k <> v_mal
       and ce_valid_transition(v_nu, k) and ce_valid_transition(k, v_mal)
     limit 1;
    if v_via is null then
      raise warning 'CE: ingen laglig väg % -> % (lead %), kortet snappar tillbaka', v_nu, v_mal, v_lead;
      new.stage_id := old.stage_id;
      return new;
    end if;
  end if;

  -- Tysta speglingen medan vi skriver, annars vill den röra kortet vi står i.
  v_forra := coalesce(current_setting('ce.mirroring', true), '0');
  perform set_config('ce.mirroring', '1', true);

  if v_via is not null then
    update ce_leads set status = v_via, updated_at = now() where id = v_lead;
    insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
    select tenant_id, v_lead, 'status_changed', v_nu, v_via, 'human',
           jsonb_build_object('via','crm-kanban','steg',v_steg,'mellansteg',true)
    from ce_leads where id = v_lead;
    v_nu := v_via;
  end if;

  update ce_leads set status = v_mal, updated_at = now() where id = v_lead;
  insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
  select tenant_id, v_lead, 'status_changed', v_nu, v_mal, 'human',
         jsonb_build_object('via','crm-kanban','steg',v_steg)
  from ce_leads where id = v_lead;

  perform set_config('ce.mirroring', v_forra, true);

  -- Håll kontaktens statusfält i takt utan att gå via speglingen.
  update contacts set status = ce_contact_status_for(v_mal),
                      custom = jsonb_set(coalesce(custom,'{}'::jsonb), '{ce_status}', to_jsonb(v_mal)),
                      updated_at = now()
  where id = new.contact_id;

  return new;
end $$;;
