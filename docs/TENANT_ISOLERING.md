# Tenant-isolering i SCC

Status 7 sep 2026: **grinden är på plats, kundvyer är inte byggda.**

## Läget innan

SCC har haft exakt en identitet. Den som har `SCC_API_TOKEN` eller en giltig
sessionscookie är operatören och ser allt. Sessionstoken bär ingen identitet
alls — den är bara en HMAC-signerad utgångstid. Det har varit korrekt så länge
ingen kund kunnat logga in, och det är fortfarande sant: **ingen kunddata
läcker idag, eftersom ingen kund kan logga in.**

Problemet är vad som händer dagen en kundinloggning byggs. 29 ruttfiler rör
kundtabeller och ingen av dem filtrerar på kund. Utan en grind öppnar den
första kundinloggningen alla 50-något rutter på en gång.

## Datamodellen

Kontrollerad mot prod 7 sep 2026.

Tolv tabeller har en egen `customer_id`: `activities`, `bookings`,
`ce_bookings`, `contacts`, `deliverables`, `messages`, `opportunities`,
`pipelines`, `prospects`, `sequences`, `tasks`, `voice_calls`.

Nio tabeller når kunden via en främmande nyckel: `costs`, `sequence_enrollments`,
`sequence_steps`, `sequence_step_runs`, `stages`, `studio_assets`,
`suppression_list`, `task_runs`, `todos`.

Resten är Skylands eget material eller har egen tenant-modell (`ce_*`, `mk_*`
med den separata `tenants`-tabellen).

**Kolumnerna är i praktiken tomma.** 2 av 183 kontakter är stämplade, noll rader
i övriga tabeller. Det är inte ett fel att laga med en backfill — det är den
naturliga följden av att nästan allt i basen är Skylands egen prospektering.

Därav regeln: **`customer_id = NULL` betyder Skyland internt.** En kund ser bara
rader som uttryckligen bär hens id. `.eq()` utesluter NULL av sig själv, så
default är att inte se något. Ingen backfill behövs; nya kundrader stämplas vid
skrivning.

## Vad som byggts

`backend/src/middleware/principal.ts` — `req.principal` är antingen
`{kind:'operator'}` eller `{kind:'customer', customerId}`. Alla tre
autentiseringsvägarna ger operatör idag. `requireOperator` nekar allt annat.

`backend/src/server.ts` — `app.use('/api/v1', requireOperator)` direkt efter
authMiddleware. Noll beteendeförändring i drift; alla 386 tester passerar.

`backend/src/services/tenantScope.ts` — `TENANT_MAP` med ett läge per tabell
(`direct` / `derived` / `internal`), `tenantFilter()` och `scopedSelect()`.
En tabell som saknas i kartan **kastar**, även för operatören. Det är avsiktligt:
en glömd tabell ska upptäckas, inte släppas förbi ofiltrerad.

## Så här öppnas en kundvy senare

1. Montera routern i `server.ts` **mellan** `authMiddleware` och
   `requireOperator`. Ta aldrig bort grinden för att öppna en rutt.
2. Läs all data via `scopedSelect(req.principal, tabell)` — aldrig
   `supabase.from()` direkt.
3. Stämpla `customer_id` vid skrivning med `stampCustomerId(req.principal)`.
4. Är tabellen `derived` behöver den ett uppslagssteg som byggs då, med test.
5. Kundinloggningen behöver dessutom en sessionstoken som faktiskt bär
   `customer_id`. Dagens token gör inte det, och det är nästa steg för
   Cold Experience-intaget.

## Kvar innan Gustav kan logga in

- Sessionstoken som bär identitet (idag: bara utgångstid + signatur)
- Kundinloggning: var kommer lösenordet ifrån, hur kopplas det till en
  `customers`-rad
- Bestäm vilka vyer Gustav faktiskt ska ha, och öppna bara dem
- Stämpla `customer_id` på Cold Experience-data vid skrivning
