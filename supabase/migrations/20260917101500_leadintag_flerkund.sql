-- ============================================================================
-- Leadintag, flerkund.
--
-- Fram till nu har Meta-leadannonser bara kunnat gå till en kund: edge-funktionen
-- meta-leads-webhook har tenanten hårdkodad i CE_TENANT_ID, och ce_mirror_lead
-- letar upp pipelinen på namnet 'Cold Experience%'. Andra kunder med snabbformulär
-- (GKMK, Vinnie) har därför fått ringa sina leads i Metas Leadcenter i stället.
--
-- Den här migrationen gör tre saker:
--   1. meta_lead_routes: ett register som översätter Metas page_id till en tenant
--      och bär kundens fältmappning. Webhooken slår upp här i stället för att
--      läsa en miljövariabel, så en ny kund är en rad, inte en ny deploy.
--   2. Tenant, kund, pipeline och stegen för Vinnie Sahlén.
--   3. ce_mirror_lead blir tenantmedveten. Cold Experience beter sig exakt som
--      förut: hittas ingen konfigurerad pipeline faller den tillbaka på
--      namnmatchningen. Ingen befintlig rad rörs.
--
-- Idempotent. Kan köras om.
-- ============================================================================

-- ---------------------------------------------------------------- 1. routing

CREATE TABLE IF NOT EXISTS meta_lead_routes (
    page_id     text PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    page_name   text,
    active      boolean NOT NULL DEFAULT true,
    -- Fältmappningen. Metas field_data har kundens egna fältnamn, så varje kund
    -- behöver sin egen översättning i stället för hårdkodade regexar i koden.
    --   field_map: { "<vår nyckel>": ["delsträng", ...] } — första träffen vinner
    --   hot_when:  { "<vår nyckel>": ["värde som gör leadet hett", ...] }
    --   notify:    { "sms_to": ["+46..."], "sms_from": "Vinnie" }
    config      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meta_lead_routes IS
  'Metas page_id → tenant + fältmappning. Raden ÄR inkopplingen av en ny kund; '
  'webhooken avvisar leads från sidor som saknar rad här.';

CREATE INDEX IF NOT EXISTS idx_meta_lead_routes_tenant ON meta_lead_routes(tenant_id);

-- --------------------------------------------------------------- 2. Vinnie

INSERT INTO tenants (slug, name, vertical, commercials, config)
VALUES (
  'vinnie', 'Vinnie Sahlén', 'tattoo',
  jsonb_build_object(
    'commission_rate', 0.10,
    'commission_basis', 'booking_value',
    'ad_spend_paid_by', 'tenant',
    'platform_ownership', 'skyland'
  ),
  jsonb_build_object(
    'lead_pipeline', 'Vinnie — leads',
    'contact_tag', 'vinnie',
    'note', 'Heldagssittningar, Göteborg. Joakim ringer leadsen och bokar in dem.'
  )
)
ON CONFLICT (slug) DO UPDATE
  SET config = tenants.config || EXCLUDED.config, updated_at = now();

-- Kunden som äger korten i CRM-vyn. customers.site_tenant_id är den koppling
-- ce_mirror_lead redan använder för att hitta rätt kund.
-- customers.slug är NOT NULL UNIQUE. tenant_id och site_tenant_id sätts båda:
-- det förra är radens ägare, det senare är kopplingen ce_mirror_lead slår upp på.
INSERT INTO customers (name, slug, tenant_id, site_tenant_id)
SELECT 'Vinnie Sahlén', 'vinnie', t.id, t.id FROM tenants t WHERE t.slug = 'vinnie'
ON CONFLICT (slug) DO UPDATE
  SET site_tenant_id = EXCLUDED.site_tenant_id,
      tenant_id      = EXCLUDED.tenant_id,
      updated_at     = now();

-- Pipelinen. Stegen speglar hur arbetet faktiskt går till: Joakim ringer,
-- bokar in i Vinnies kalender, Vinnie tatuerar.
WITH k AS (
  SELECT c.id, t.id AS tid FROM customers c JOIN tenants t ON t.id = c.site_tenant_id
  WHERE t.slug = 'vinnie' LIMIT 1
), p AS (
  INSERT INTO pipelines (customer_id, tenant_id, name)
  SELECT k.id, k.tid, 'Vinnie — leads' FROM k
  WHERE NOT EXISTS (SELECT 1 FROM pipelines WHERE name = 'Vinnie — leads')
  RETURNING id
), pid AS (
  SELECT id FROM p UNION ALL SELECT id FROM pipelines WHERE name = 'Vinnie — leads' LIMIT 1
)
INSERT INTO stages (pipeline_id, name, position)
SELECT pid.id, s.name, s.pos
FROM pid, (VALUES
  ('Ny', 0), ('Ringd', 1), ('Het', 2), ('Bokad', 3), ('Genomförd', 4), ('Avböjt', 5)
) AS s(name, pos)
WHERE NOT EXISTS (
  SELECT 1 FROM stages x WHERE x.pipeline_id = pid.id AND x.name = s.name
);

-- Routingraden för Vinnies Facebook-sida. Fältnamnen kommer från snabbformuläret
-- "Vinnie – Heldagssittning (SE)": namn, telefon, e-post och två egna frågor.
INSERT INTO meta_lead_routes (page_id, tenant_id, page_name, config)
SELECT '1021795327677822', t.id, 'Vinnie.Sahlén',
  jsonb_build_object(
    'field_map', jsonb_build_object(
      'full_name', jsonb_build_array('full_name', 'namn', 'name'),
      'phone',     jsonb_build_array('phone', 'telefon'),
      'email',     jsonb_build_array('email', 'e-post', 'epost'),
      'experience',jsonb_build_array('tatuerat', 'tidigare'),
      'project',   jsonb_build_array('tänker', 'projekt', 'motiv', 'idé')
    ),
    'hot_when', jsonb_build_object(
      'experience', jsonb_build_array('ja, flera gånger', 'ja')
    ),
    'notify', jsonb_build_object(
      'sms_to', jsonb_build_array('+46735643495'),
      'sms_from', 'Vinnie'
    )
  )
FROM tenants t WHERE t.slug = 'vinnie'
ON CONFLICT (page_id) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id,
      page_name = EXCLUDED.page_name,
      config    = meta_lead_routes.config || EXCLUDED.config,
      updated_at = now();

-- ------------------------------------------------- 3. tenantmedveten spegel

-- Vilken pipeline ett lead ska hamna i. Ordningen är medveten:
--   1. tenants.config->>'lead_pipeline' — det uttryckliga valet
--   2. kundens egen pipeline, om kunden bara har en
--   3. 'Cold Experience%' — så att CE fortsätter fungera exakt som förut
CREATE OR REPLACE FUNCTION public.lead_pipeline_for(p_tenant uuid, p_customer uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v_namn text; v_pipeline uuid;
BEGIN
  SELECT config->>'lead_pipeline' INTO v_namn FROM tenants WHERE id = p_tenant;
  IF v_namn IS NOT NULL THEN
    SELECT id INTO v_pipeline FROM pipelines WHERE name = v_namn LIMIT 1;
    IF v_pipeline IS NOT NULL THEN RETURN v_pipeline; END IF;
  END IF;

  SELECT id INTO v_pipeline FROM pipelines WHERE customer_id = p_customer LIMIT 1;
  IF v_pipeline IS NOT NULL THEN RETURN v_pipeline; END IF;

  SELECT id INTO v_pipeline FROM pipelines WHERE name LIKE 'Cold Experience%' LIMIT 1;
  RETURN v_pipeline;
END $$;

COMMENT ON FUNCTION public.lead_pipeline_for IS
  'Pipeline för ett lead: tenantens val, annars kundens egen, annars CE. '
  'Sista steget finns bara för bakåtkompatibilitet med Cold Experience.';

-- ce_mirror_lead: samma spegel som förut, med tre ändringar.
--   * pipelinen hämtas via lead_pipeline_for i stället för namnmatchning
--   * taggen och source följer tenanten i stället för att alltid vara cold-experience
--   * CE-specifika fält skrivs bara när de faktiskt har värden (jsonb_strip_nulls
--     gjorde redan det, men nu är det avsiktligt och inte en bieffekt)
-- Allt annat är oförändrat: samma dedupe_key, samma merge av custom, samma
-- loopspärr via ce.mirroring.
CREATE OR REPLACE FUNCTION public.ce_mirror_lead(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  l record; v_customer uuid; v_pipeline uuid; v_stage uuid; v_contact uuid;
  v_titel text; v_nyckel text; v_hot boolean; v_forra text;
  v_slug text; v_tagg text;
begin
  select * into l from ce_lead_overview where id = p_lead_id;
  if not found then return; end if;

  select id into v_customer from customers where site_tenant_id = l.tenant_id limit 1;
  v_pipeline := lead_pipeline_for(l.tenant_id, v_customer);
  if v_customer is null or v_pipeline is null then return; end if;

  select t.slug, coalesce(t.config->>'contact_tag', t.slug)
    into v_slug, v_tagg from tenants t where t.id = l.tenant_id;
  v_slug := coalesce(v_slug, 'cold-experience');
  v_tagg := coalesce(v_tagg, 'cold-experience');

  v_forra := coalesce(current_setting('ce.mirroring', true), '0');
  perform set_config('ce.mirroring', '1', true);

  v_hot := l.hot_at is not null;
  v_nyckel := 'ce:' || l.id::text;
  select s.id into v_stage from stages s
    where s.pipeline_id = v_pipeline and s.name = ce_stage_for(l.status, v_hot) limit 1;
  -- Kundens egna stegnamn behöver inte matcha CE:s. Hittas inget steg hamnar
  -- kortet i pipelinens första steg i stället för att bli stegslöst och osynligt.
  if v_stage is null then
    select s.id into v_stage from stages s
      where s.pipeline_id = v_pipeline order by s.position limit 1;
  end if;

  insert into contacts (customer_id, tenant_id, name, email, phone, source, status, dedupe_key, tags, custom)
  values (
    v_customer, l.tenant_id,
    coalesce(nullif(l.name,''), 'Okänt namn'), l.email, l.phone,
    replace(v_slug, '-', '_'), ce_contact_status_for(l.status), v_nyckel,
    array_remove(array[
      v_tagg,
      case when l.country is not null then 'land:'  || lower(l.country) end,
      case when l.channel is not null then 'kanal:' || l.channel end,
      case when l.intent  is not null then 'vill:'  || l.intent end,
      case when not l.answered then 'obesvarad' end
    ], null),
    jsonb_strip_nulls(jsonb_build_object(
      'ce_lead_id', l.id, 'ce_channel', l.channel, 'ce_intent', l.intent,
      'ce_country', l.country, 'ce_message', l.guest_message,
      'ce_last_inbound', l.last_inbound_body, 'ce_received_at', l.received_at,
      'ce_answered', l.answered, 'ce_messages_in', l.messages_in, 'ce_messages_out', l.messages_out,
      'ce_travel_when', l.travel_when, 'ce_days', l.days, 'ce_adults', l.adults,
      'ce_departure', l.departure, 'ce_price_eur', l.price_quoted_eur,
      'ce_callback', l.callback_window, 'ce_ad_name', l.ad_name, 'ce_status', l.status,
      'ce_form', (select qualification->'form' from ce_leads where id = l.id)
    ))
  )
  on conflict (dedupe_key) where dedupe_key is not null do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone,
    status = excluded.status, tags = excluded.tags,
    custom = coalesce(contacts.custom, '{}'::jsonb) || excluded.custom,
    updated_at = now()
  returning id into v_contact;

  if v_contact is null then select id into v_contact from contacts where dedupe_key = v_nyckel; end if;

  if v_contact is not null then
    v_titel := coalesce(nullif(l.name,''), 'Okänt namn')
               || case when l.days is not null then ' · ' || l.days || ' dagar' else '' end;

    if exists (select 1 from opportunities where contact_id = v_contact and pipeline_id = v_pipeline) then
      update opportunities set stage_id = v_stage, title = v_titel,
        status = case when l.status='booked' then 'won'
                      when l.status in ('cold','lost','opted_out') then 'lost' else 'open' end,
        updated_at = now()
      where contact_id = v_contact and pipeline_id = v_pipeline
        and (stage_id is distinct from v_stage or title is distinct from v_titel);
    else
      insert into opportunities (contact_id, pipeline_id, stage_id, customer_id, tenant_id, title, status)
      values (v_contact, v_pipeline, v_stage, v_customer, l.tenant_id, v_titel,
              case when l.status='booked' then 'won'
                   when l.status in ('cold','lost','opted_out') then 'lost' else 'open' end);
    end if;
  end if;

  perform set_config('ce.mirroring', v_forra, true);
end $function$;
