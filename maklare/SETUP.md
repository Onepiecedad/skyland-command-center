# Mäklaragenten — status och nästa steg

Allt ligger i **skyland-command-center** (`wfwqjxsuvbacvcmpiesl`) som `mk_`-vertikal, samma
tenant-/RLS-mönster som `ce_`.

## Vad som körts skarpt

Migrationerna är applicerade, två edge-funktioner är deployade, och riktiga objekt ligger
inne som demodata under två tenants (båda `paused`, `config.demo = true` — prospekt, inte kunder).

| Tenant | Objekt | Till salu | Budgivning | Kommande | Visningar |
|---|---|---|---|---|---|
| `husman-hagberg-molndal` (M16501) | 28 | 13 | 3 | 12 | 13 |
| `husmanhagberg-goteborg` (6 kontor) | 201 | 92 | 6 | 103 | 49 |

Avstämt mot HusmanHagbergs eget API, kontor för kontor: 25 + 124 + 7 + 16 + 16 + 13 = 201
för Göteborg, 28 för Mölndal. Noll avvikelse. 20 mäklare, alla objekt har en kopplad mäklare.
12 slumpade objekt-URL:er kontrollerade — samtliga 200, ingen soft-404.

Verifierat mot riktig data:

```
mk_search_listings(… 'Mölndal', 'villa', max 8 mkr …)
→ "villa på Älgvägen 1, Kållered, 8 rum, 263 kvadratmeter, 7 300 000 kronor"

mk_upcoming_viewings(…)
→ 6 visningar, Lekevallsgatan 70 den 30 augusti 11:30 först ut

mk_capture_lead(… '070-123 45 67' …) två gånger
→ EN lead, båda meddelandena bevarade, callback kvar. Dedupe fungerar.
```

## Databasen

| Tabell | Roll |
|---|---|
| `mk_brokers` | Mäklare per byrå. Handoff-kontakt. |
| `mk_listings` | **Strukturerad objektdata.** Röstagenten frågar den via verktygsanrop, inte vektorsök. Unik på `(tenant_id, external_id)`. |
| `mk_viewings` | Visningstider per objekt. Unik på `(tenant_id, listing_id, starts_at)`. |
| `mk_documents` | Vektorlagret för statiskt innehåll. Unik på `(tenant_id, source_url, chunk_index)`. |
| `mk_crawl_pages` | Crawl-register med `content_hash`. Gör veckorefreshen nästan gratis. |
| `mk_leads` | Leads från röstagenten, dedupe på telefon/e-post. |
| `mk_lead_events` | Append-only. Statusövergångar, handoff, opt-out. |

RLS: `anon` nekas helt, `authenticated` ser bara sin egen tenant, service role går förbi.

### Funktioner

- `mk_search_listings(p_tenant, p_query, p_area, p_object_type, p_min_rooms, p_max_price, p_min_living_area, p_status, p_limit)`
- `mk_get_listing(p_listing_id, p_tenant)` — inkl. mäklare och kommande visningar
- `mk_upcoming_viewings(p_tenant, p_listing_id, p_limit)`
- `match_mk_documents(query_embedding, p_tenant, match_threshold, match_count)`
- `mk_capture_lead(...)` — upsert med dedupe, loggar till `mk_lead_events`
- `mk_erase_lead(p_lead_id, p_reason)` — GDPR-radering
- `mk_opt_out(p_lead_id, p_reason)` — kunden vill inte bli kontaktad

`mk_listing_summary` bygger uppläsningsbar svenska: "7 300 000 kronor", "39,5 kvadratmeter",
och nämner status bara när den avviker från till salu.

**Leads raderas aldrig med DELETE** — händelseloggen är append-only, så en DELETE blockeras
av en trigger. Använd `mk_erase_lead()`, som nollar PII och stämplar `erased_at`. Det är
också det som är rätt svar när en kund åberopar rätten att bli glömd: bokningar och
attribution finns kvar, personuppgifterna gör det inte.

## Edge function `mk-agent` (deployad, v1)

`POST https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-agent/<action>`

Headers: `x-mk-secret: <MK_AGENT_SECRET>`, `x-mk-tenant: <tenant-slug>`

Actions: `search_listings`, `get_listing`, `upcoming_viewings`, `ask_knowledge`, `capture_lead`.
Varje svar har ett `spoken`-fält på svenska. `verify_jwt` är av — auth sker på delad hemlighet.
Verifierat: anrop utan rätt secret ger 401.

### Innan den svarar på riktigt

Supabase → **Edge Functions** i vänsterspalten → fliken **Secrets**
(https://supabase.com/dashboard/project/wfwqjxsuvbacvcmpiesl/functions/secrets):

```
MK_AGENT_SECRET   = openssl rand -hex 32
OPENAI_API_KEY    = <din nyckel>            # används av ask_knowledge
MK_EMBED_MODEL    = text-embedding-3-small  # valfritt
```

Sen fungerar `sok_objekt`, `hamta_objekt`, `kommande_visningar` och `registrera_lead`
direkt mot Mölndalsdatan. `fraga_om_byran` är tom tills RAG-workflowet körts.

## Workflows

### `n8n-mk-listings.json` — objektscrapern

HusmanHagberg kör Next.js med Vitec Express-data i `__NEXT_DATA__`. All objektdata ligger
alltså som färdig JSON i sidkällan — ingen HTML-parsning, ingen sök-API behövs.
Objekt-URL:erna har formen `/objekt/<slug>/OBJ<vitec_id>_<id>/`, så kontorets objekt
plockas ut direkt ur sitemapen på `OBJ16501_`.

Parsern är testad mot samtliga 15 objekt, noll fel. Den hanterar:

- `statusId` + `bidding` + `showAsComing` → `till_salu` / `budgivning` / `kommande` / `såld` / `avtal`
- `propertyType` → normaliserad objekttyp (villa, radhus, lägenhet, fritidshus, tomt, gård)
- `elevator: "Yes"` → boolean, `floor: 5` + `totalNumberFloors: 7` → "5 av 7"
- `startingPrice: 0` → `null`. Noll betyder "uppgift saknas", inte gratis.
- `energyClass: "None"` → `null`
- brf-namn ur `details.association.name`, driftkostnad ur `details.operation.sum`
- visningar med bokningslänk ur `baseInformation.viewings`
- **falska Z-stämplar**: Vitec skriver svensk lokaltid med `Z` på slutet.
  `2026-09-05T11:00:00Z` betyder 11:00 svensk tid, inte 11:00 UTC. Parsern tolkar dem som
  Europe/Stockholm och räknar om till rätt instans, med sommar-/vintertid hanterad.
  Verifierat mot vad sajten faktiskt visar för sex visningar.

Kommande objekt döljer adress och pris på sajten — de fälten blir `null`, som avsett.

Flödet: sitemap → filtrera på vitec_id → loop → hämta sida → parsa → upsert mäklare →
upsert objekt → rensa och skriv om visningar → nästa. Efter loopen markeras objekt som
inte dök upp i körningen som `tillbakadragen` (sålda rörs inte). Ett objekt som inte går
att parsa loggas i `mk_crawl_pages` och stoppar inte körningen.

Kör var 6:e timme. Byt `tenant_slug` + `vitec_id` i Config-noden per byrå.

### `n8n-mk-rag.json` — statiskt innehåll

Åtgärdat mot den gamla versionen:

- **Dedupe**: allt för sidans `source_url` raderas innan insert, plus unikt index som skyddsnät
- **Misslyckad crawl** får en egen gren som loggar och går vidare
- **Explicit Wait** 5 s, ger upp efter 24 försök (~2 min)
- **En plats för URL:er** — Config-noden
- **Recursive splitter 1000/200** med separatorerna `\n\n → \n → ". " → " "`
- **Inga tokens i noder** — Header Auth för crawl4ai, `supabaseApi`, `openAiApi`
- **Hash-check**: oförändrade sidor embeddas inte om
- **Objektsidor filtreras bort** — de hör hemma i `mk_listings`
- Alla upserts mot `mk_crawl_pages` har `on_conflict=tenant_id,url` satt

**Rotera den läckta bearer-token innan du kör.**

## Kvar

- Sätt secrets och testa hela kedjan från ElevenLabs
- Peka RAG-workflowet på husmanhagberg.se/fastighetsmaklare/molndal/ och kör en första indexering
- PUB-avtal innan skarp lead-insamling hos kund
- Notifiering vid ny lead — häng en webhook på `mk_lead_events`
- Andra byråplattformar behöver egna parsers. Kör byrån Vitec Express bakom Next.js
  fungerar samma mönster; Mspecs och Fasad ser annorlunda ut.
