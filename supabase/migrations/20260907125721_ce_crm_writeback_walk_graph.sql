-- Korten i Het har status 'new' (formulärleads stämplas hot_at men får inte gå
-- new -> hot). Drar Gustav ett sådant kort till Överlämnad är den direkta
-- övergången otillåten, trots att vägen new -> in_conversation -> handed_off är det.
-- I stället för att neka flytten går vi via mellansteget. Varje enskild övergång
-- valideras fortfarande av systemets egen ce_valid_transition.

create or replace function ce_opp_stage_writeback()
returns trigger language plpgsql as $$
declare
  v_lead uuid; v_steg text; v_mal text; v_nu text; v_via text;
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

  if ce_valid_transition(v_nu, v_mal) then
    update ce_leads set status = v_mal, updated_at = now() where id = v_lead;
    insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
    select tenant_id, v_lead, 'status_changed', v_nu, v_mal, 'human',
           jsonb_build_object('via','crm-kanban','steg',v_steg)
    from ce_leads where id = v_lead;
    return new;
  end if;

  -- Ett hopp räcker nästan alltid: hitta ett mellanläge som är lagligt åt båda hållen.
  select k into v_via from unnest(KANDIDATER) k
   where k <> v_nu and k <> v_mal
     and ce_valid_transition(v_nu, k) and ce_valid_transition(k, v_mal)
   limit 1;

  if v_via is null then
    raise warning 'CE: ingen laglig väg % -> % (lead %), kortet snappar tillbaka', v_nu, v_mal, v_lead;
    new.stage_id := old.stage_id;
    return new;
  end if;

  update ce_leads set status = v_via, updated_at = now() where id = v_lead;
  insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
  select tenant_id, v_lead, 'status_changed', v_nu, v_via, 'human',
         jsonb_build_object('via','crm-kanban','steg',v_steg,'mellansteg',true)
  from ce_leads where id = v_lead;

  update ce_leads set status = v_mal, updated_at = now() where id = v_lead;
  insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
  select tenant_id, v_lead, 'status_changed', v_via, v_mal, 'human',
         jsonb_build_object('via','crm-kanban','steg',v_steg)
  from ce_leads where id = v_lead;

  return new;
end $$;;
