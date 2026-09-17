# Leadintag, flerkund

**Skapad:** 2026-09-17 · **Status:** kod skriven och typkontrollerad, inte deployad.

## Varför

`meta-leads-webhook` har Cold Experience hårdkodad: `CE_TENANT_ID` i miljön och
`pipelines where name like 'Cold Experience%'` i speglingen. Kunder med
snabbformulär men utan det här intaget — GKMK och nu Vinnie — får i stället ringa
sina leads i Metas Leadcenter. Det är inte en rutin, det är en risk: den 17
september låg sex leads från Vinnies första annonsdag och kallnade utan att någon
visste om dem.

Det här är samma flöde, men kundlöst. Tenanten slås upp på Metas `page_id`.

## Delarna

| Vad | Var |
|-----|-----|
| Edge function | `supabase/functions/lead-intake/index.ts` |
| Migration | `supabase/migrations/20260917101500_leadintag_flerkund.sql` |
| Routingtabell | `meta_lead_routes` (page_id → tenant + fältmappning) |
| Vinnies pipeline | `Vinnie — leads`: Ny → Ringd → Het → Bokad → Genomförd → Avböjt |

Flödet: Meta → `lead-intake` → `ce_leads` → trigger `ce_mirror_lead` → `contacts`
+ `opportunities` → kortet i kanban. Notis-SMS till den som ska ringa.

Cold Experience rörs inte. `ce_mirror_lead` faller tillbaka på namnmatchningen när
tenanten saknar konfigurerad pipeline, så CE beter sig exakt som förut.

## Att `ce_leads` heter ce_

Tabellen är tenantskopad och har redan fälten ett annonslead behöver, så den
återanvänds i stället för att en ny byggs. Namnet är historiskt och missvisande.
Döp om när något ändå ska röras i den delen — inte nu, mitt i en levande kampanj.

## Koppla in Vinnie

### 1. Kör migrationen

```bash
supabase db push --project-ref wfwqjxsuvbacvcmpiesl
```

Kontrollera efteråt:

```sql
select page_id, page_name, tenant_id from meta_lead_routes;
select name, position from stages
  where pipeline_id = (select id from pipelines where name = 'Vinnie — leads')
  order by position;
```

### 2. Meta-app

Vinnies sida ligger i portföljen `Vinnie Sahlén` (192408598264971), inte i
coldexperience.se. Appen `Cold Experience Leads` (966370799807849) når den alltså
inte. Skapa en app i Skylands egen portfölj — den blir hemvist för alla kunder
framåt, och då behöver det här aldrig göras om.

1. Ny app på developers.facebook.com, typ **Business**, kopplad till Skylands portfölj.
2. Lägg till produkten **Webhooks** → objekt **Page**.
3. Callback URL: `https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/lead-intake`
   Verify token: samma sträng som `META_VERIFY_TOKEN`.
4. Prenumerera på fältet **leadgen**.
5. Skapa en **systemanvändare** i Business Settings med tillgång till Vinnies sida,
   och ett token med `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`. Sätt token utan utgångsdatum.
6. Prenumerera sidan på appen:

```bash
curl -X POST "https://graph.facebook.com/v21.0/1021795327677822/subscribed_apps?subscribed_fields=leadgen" \
  -H "Authorization: Bearer <SYSTEMANVÄNDARTOKEN>"
```

Kontrollera:

```bash
curl "https://graph.facebook.com/v21.0/1021795327677822/subscribed_apps" \
  -H "Authorization: Bearer <SYSTEMANVÄNDARTOKEN>"
```

7. Under **Leadsåtkomst** i Business Settings: ge systemanvändaren åtkomst till
   sidans leads. Utan det svarar Graph med behörighetsfel när leadet hämtas, och
   webhooken loggar felet utan att skapa något kort.

### 3. Secrets

```bash
supabase secrets set \
  META_APP_SECRET=<appens hemlighet> \
  META_VERIFY_TOKEN=<samma som i Metas dialog> \
  META_PAGE_TOKEN=<systemanvändartoken> \
  --project-ref wfwqjxsuvbacvcmpiesl
```

`ELKS_USER` och `ELKS_PASS` finns redan i projektet och delas med CE-funktionen.
Saknas de går leadet ändå in, men inget SMS går ut.

### 4. Deploya

```bash
supabase functions deploy lead-intake --no-verify-jwt --project-ref wfwqjxsuvbacvcmpiesl
```

`--no-verify-jwt` är nödvändigt: Meta skickar ingen JWT. Signaturen kontrolleras
i stället mot `META_APP_SECRET`.

### 5. Testa

```bash
# Vilka sidor är inkopplade?
curl "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/lead-intake?routes=1"
```

Skicka sedan ett testlead från Metas **Testverktyg för leadannonser** mot
formuläret. Det ska hamna i `ce_leads` med `custom->>'test' = 'true'` och synas
som kort i `Vinnie — leads`. Testleads får inget SMS.

```sql
select name, phone, status, hot_reasons, custom->>'test' as test, created_at
from ce_leads
where tenant_id = (select id from tenants where slug='vinnie')
order by created_at desc limit 5;
```

## Nästa kund

En rad, ingen deploy:

```sql
insert into tenants (slug, name, vertical, config)
values ('gkmk', 'Göteborgs Krav Maga Klubb', 'sport',
        jsonb_build_object('lead_pipeline','GKMK — leads','contact_tag','gkmk'));

insert into customers (name, slug, tenant_id, site_tenant_id)
select 'Göteborgs Krav Maga Klubb', 'gkmk', id, id from tenants where slug='gkmk';

-- pipeline + stages, sedan:
insert into meta_lead_routes (page_id, tenant_id, page_name, config)
select '<sidans id>', id, 'GKMK', jsonb_build_object(
  'field_map', jsonb_build_object(
    'full_name', jsonb_build_array('full_name','namn'),
    'phone',     jsonb_build_array('phone','telefon'),
    'email',     jsonb_build_array('email','e-post')),
  'notify', jsonb_build_object('sms_to', jsonb_build_array('+46...'), 'sms_from','GKMK')
) from tenants where slug='gkmk';
```

Sidan måste också prenumereras på appen med samma `subscribed_apps`-anrop.

## Kvar att göra

- **Sex leads från 17 september ligger kvar i Metas Leadcenter.** De kom in innan
  webhooken fanns och hämtas inte automatiskt. Antingen exporteras de därifrån och
  läses in för hand, eller så byggs en backfill motsvarande `?backfill=1` i
  CE-funktionen. Backfill saknas medvetet i den här versionen: den är lätt att
  lägga till och farlig att ha innan flödet bevisat sig.
- **Kortvyn visar prospekteringsfält.** `PipelineBoard.tsx` ritar betyg,
  recensioner och Instagram, som ett annonslead inte har. Kortet fungerar, men det
  ser tomt ut på fel ställen.
- **Ingen vakthund.** CE-funktionen larmar när det varit tyst för länge. Det här
  intaget gör det inte, och tystnad ser likadan ut som lugn.

## Backfill — leads som kom in innan webhooken var kopplad

Ett lead som landade i Metas Leadcenter innan sidan prenumererade på appen kommer
aldrig in av sig själv. `lead-intake` har därför ett administratörsanrop som läser
formulärets leadlista och kör varje lead genom exakt samma väg som webhooken.

    POST /functions/v1/lead-intake?backfill=1
    Authorization: Bearer $LEAD_INTAKE_ADMIN_KEY
    { "page_id": "...", "form_id": "...", "since": "2026-09-01", "dry_run": true }

- `page_id` krävs och måste finnas som aktiv rad i `meta_lead_routes`.
- `form_id` valfritt. Utelämnas det listas sidans aktiva formulär automatiskt.
- `since` valfritt ISO-datum. Listan är fallande, så den slutar vid första äldre.
- `max` valfritt, standard 500, tak 2000.
- `dry_run: true` räknar bara, skriver inget.
- `notify: true` skickar SMS. Standard är tyst — gamla leads ska inte larma.

Idempotent på `dedupe_key = leadgen:<id>`, så den kan köras om.

### Behörigheter

Systemanvändartokenen behöver mer för backfillen än för webhooken:

| Anrop | Krav |
|---|---|
| `GET /{leadgen_id}` (webhooken) | `leads_retrieval` |
| `GET /{form_id}/leads` (backfill) | `leads_retrieval` + `pages_manage_ads` |
| `GET /{page_id}/leadgen_forms` (autolista formulär) | `pages_manage_ads` |

Saknas `pages_manage_ads` svarar Graph `(#200) Requires pages_manage_ads permission`
eller `does not exist ... error_subcode 33`. Generera om systemanvändartokenen med
båda behörigheterna och växla den mot en ny sidtoken:

    curl -s "https://graph.facebook.com/v21.0/$PAGE_ID?fields=access_token&access_token=$SU_TOKEN"
    supabase secrets set META_PAGE_TOKEN="<sidtoken>"
