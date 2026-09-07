-- Håll speglingen färsk.

create or replace function ce_leads_mirror_trg()
returns trigger language plpgsql as $$
begin
  perform ce_mirror_lead(new.id);
  return new;
end $$;

drop trigger if exists trg_ce_leads_mirror on ce_leads;
create trigger trg_ce_leads_mirror
  after insert or update on ce_leads
  for each row execute function ce_leads_mirror_trg();

-- Ett nytt meddelande ändrar "obesvarad" och antalen på kortet.
create or replace function ce_msg_mirror_trg()
returns trigger language plpgsql as $$
begin
  if new.lead_id is not null then perform ce_mirror_lead(new.lead_id); end if;
  return new;
end $$;

drop trigger if exists trg_ce_msg_mirror on ce_messages;
create trigger trg_ce_msg_mirror
  after insert on ce_messages
  for each row execute function ce_msg_mirror_trg();

-- Vägen tillbaka: drar Gustav ett kort mellan kolumnerna ska leadet följa med.
-- Utan det skriver nästa webhook över hans flytt.
--
-- Loopen bryts av två saker: triggern körs bara när stage_id faktiskt ändrats,
-- och ce_leads uppdateras bara när statusen skiljer sig. Är de överens skrivs inget.
create or replace function ce_opp_stage_writeback()
returns trigger language plpgsql as $$
declare
  v_lead uuid; v_steg text; v_ny text; v_nu text;
begin
  select (c.custom->>'ce_lead_id')::uuid into v_lead
    from contacts c where c.id = new.contact_id and c.dedupe_key like 'ce:%';
  if v_lead is null then return new; end if;

  select name into v_steg from stages where id = new.stage_id;
  if v_steg is null then return new; end if;

  v_ny := ce_status_for(v_steg);
  select status into v_nu from ce_leads where id = v_lead;

  -- "Het" och "Ny" är båda status new. Flytt mellan dem ska inte skriva.
  if v_nu is distinct from v_ny then
    update ce_leads set status = v_ny, updated_at = now() where id = v_lead;
    insert into ce_lead_events (tenant_id, lead_id, event_type, from_status, to_status, actor, payload)
    select tenant_id, v_lead, 'status_changed', v_nu, v_ny, 'human',
           jsonb_build_object('via','crm-kanban','steg',v_steg)
    from ce_leads where id = v_lead;
  end if;
  return new;
end $$;

drop trigger if exists trg_ce_opp_writeback on opportunities;
create trigger trg_ce_opp_writeback
  after update of stage_id on opportunities
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function ce_opp_stage_writeback();

comment on function ce_opp_stage_writeback is
  'Kanban-flytt skriver tillbaka till ce_leads.status. Skriver inget när status redan stämmer, vilket bryter loopen mot ce_leads_mirror_trg.';;
