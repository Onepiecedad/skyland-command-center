# Sajtflöden — skylandai.se och kundsajter → SCC (SCC-48, SCC-51, SCC-52)

> Ersätter n8n-workflows (arkiverade i `docs/n8n-archive/`). Kontrakten mot sajtens JS är
> bevarade 1:1, sajten bytte bara bas-URL. Kod: `backend/src/routes/siteWebhooks.ts`,
> `backend/src/services/siteRag.ts`. Monterat på `/api/v1/webhooks/site` **före** global auth.
>
> **Sedan 7 sep (SCC-51) är intaget flerkundsstöttat.** Samma endpoints tar emot från
> kundernas sajter, och varje rad i `sessions`/`events` bär `tenant_id`. Läs avsnittet
> "Flera sajter i samma intag" innan du rör något här.

## Endpoints

| Route | Anropas av | Auth | Gör |
|---|---|---|---|
| `POST /session-init` | `app/session.js` vid ny session | publik, 60/min | upsert `sessions` (uuid v4, user_agent, entry_module). Svarar `[rad]` (n8n-format). |
| `POST /track-event` | `app/tracker.js` (fetch keepalive) | publik, 60/min | whitelist på 13 eventtyper + datafält, max 25/batch, insert `events`. `{ok:true}`. |
| `POST /session-status` | `app/dashboard.js` polling | publik, 60/min | `{session_uuid, prospect, events[]}` från `prospects` + `interactions`. |
| `POST /void-submission` | `app/void.js` (The Void-formuläret) | publik, 6/min | validera (consent!) → upsert session → insert `prospects` → regelpoäng → RAG → gpt-4o-mini (svensk/engelsk systemprompt) → insert `interactions` → `ingestLead()` in-process → `{status:'success', lead_id, ai_response, best_match_similarity}`. |
| `POST /rag-query` | server-till-server | `X-Skyland-Key` = `SITE_RAG_KEY` \|\| `LEADS_INTAKE_TOKEN` | embeddings + `match_knowledge_base` (tröskel 0.35, topp 3). |
| `POST /voice/signed-url` | `app/voice.js` | publik, 10/min | `{session_uuid, agent_id}` → ElevenLabs get-signed-url med `SITE_ELEVENLABS_API_KEY` \|\| `ELEVENLABS_API_KEY`. |
| `POST /voice/call-ended` | `app/voice.js` efter samtal | publik, 10/min | normalisera → `handleVoiceCallEnded()`: session, prospect-koppling, gpt-4o-mini JSON-extraktion (namn, företag, bransch ur fast kategorilista, mejl, smärtpunkter, mötesönskan, summary), upsert `voice_calls` (provider+external_call_id), insert `interactions`, `ingestLead()`. `{status:'accepted'}`. |
| `POST /voice-call-ended` | ev. extern proxy | token `SITE_VOICE_WEBHOOK_TOKEN` \|\| `LEADS_INTAKE_TOKEN` | samma som ovan, n8n-svarformat. |
| `POST /agent-tools/query_knowledge_base` | ElevenLabs-agenten | `X-Skyland-Key` | RAG. |
| `POST /agent-tools/get_current_time` | ElevenLabs-agenten | `X-Skyland-Key` | nu, tidszon, start/end 7 dagar. |
| `POST /agent-tools/get_available_slots` | ElevenLabs-agenten | `X-Skyland-Key` | Cal.com v2 `/slots`, max 4/dag, `{start,label}`. |
| `POST /agent-tools/book_meeting` | ElevenLabs-agenten | `X-Skyland-Key` | `bookCalcomAppointment()` + activity `voice.booking.created`. Cal.com-webhooken speglar sedan till `bookings`. |

Lead-intaget (`leads.ts`) exporterar `ingestLead()` och `leadIntakeSchema`; sajtflödena anropar
det direkt istället för att göra HTTP mot sig själva.

## Flera sajter i samma intag (SCC-51, 7 sep 2026)

Före detta var `sessions` och `events` enkundsbyggda: ingen kolumn sa vilken sajt en rad kom
från, och allt som låg där var skylandai.se underförstått. `website.ts` filtrerade följaktligen
inte alls — första gången en kundsajt skickade något hade deras siffror hamnat i Skylands.

**Datamodellen.** `tenants` fick `site_key` (unik) och `allowed_origins text[]`.
`sessions` och `events` fick `tenant_id` med default = skyland-tenanten
`8270706f-5bf8-4996-804b-a30fba20831d`, backfillade (316 sessioner, 1197 händelser), NOT NULL,
index på `(tenant_id, created_at)` och `(tenant_id, type)`. `customers` fick **`site_tenant_id`** —
skild från `tenant_id`, som betyder ägare av kundposten och används av RLS. Skriv aldrig om
`customers.tenant_id` för att peka ut en sajt; kunden försvinner då ur operatörens egen vy.

**Vem får skriva som vem.** `resolveTenant(req)` i `siteWebhooks.ts`:

- ingen `site_key` i bodyn → skyland. Det är därför skylandai.se fortsätter oförändrad.
- `site_key` → slås upp i `tenants` (cachas 60 s), måste vara `status='active'`, och `Origin`
  måste stå i tenantens `allowed_origins`.
- **Tom `allowed_origins` nekas.** Tomt betyder inte fritt fram — annars vore en läckt nyckel
  helt oskyddad. Fem tenants ligger med tom lista och kan alltså inte spåra förrän någon fyller i.

Sajtnyckeln ligger i webbläsarens bundle och är ingen hemlighet. Origin-kontrollen stoppar andra
webbplatsers besökare, **inte** någon som sätter headern själv med curl. Skadan är påhittad
telemetri; ingen data läcker. Vill man åt det på riktigt krävs signerade anrop — eget ticket.

`upsertSession()` vägrar flytta en befintlig `session_uuid` mellan tenants. Unikheten på
`session_uuid` är global, inte per kund, så utan den kontrollen kan en upsert tyst flytta någons
session till en annan kund. Hittat 7 sep när ett testanrop återanvände ett gammalt placeholder-uuid.

**Trattkonfiguration per kund** ligger i `tenants.config.webb`:

| Fält | Betyder |
|---|---|
| `engagemang` | eventtyper som räknas som engagerad session |
| `lead` | eventtyper som räknas som lead |
| `avslut` | eventtyper som räknas som avslut (betalning) |
| `visa` | vilka kort Hemsida-vyn ska rita: `besok`, `engagemang`, `lead`, `avslut`, `rost`, `bokning`, `roi`, `sprak`. Tom lista = allt, vilket är Skylands läge. |

`website.ts` `/stats` och `/sessions` tar `?tenant=<slug>`, defaultar till `skyland`, och läser
tratten därifrån. `prospects` och `voice_calls` saknar `tenant_id` och tillhör bara Skyland — för
andra kunder returneras de tomma, annars hade deras tratt fått Skylands leads.

Kundkortet (`CustomerView.tsx`) visar en **Hemsida**-flik för kunder som har `site_tenant_slug`.
Den återanvänder hela `WebsiteView` med `visaWorkflows={false}`.

### Anslutna kundsajter

| Tenant | Sajt | Repo | Tracker | Engagemang / lead / avslut |
|---|---|---|---|---|
| `marinmekaniker` | marinmekaniker.nu | `Onepiecedad/MarinMekaniker` | `frontend/src/utils/spar.js` | `bestall_start`, `kit_valt`, `form_start` / `form_submit`, `tel_klick` / `swish_start`, `swish_betald` |
| `cold-experience` | coldexperience.se | `Onepiecedad/ColdExperience` (`Projekt/ColdExperience-4`) | `frontend/src/utils/spar.js` | `upplevelse_visad`, `form_start` / `form_submit` / — |

Cold Experience visar dessutom `sprak` (sajten finns på sv/en/de/pl). MarinMekaniker visar
`avslut` (Swish) men varken röst eller bokning.

Nya eventtyper måste in i `ALLOWED_EVENTS` i `siteWebhooks.ts` **och** få sina datafält
vitlistade i `sanitizeEvents()`, annars tappas de tyst. Etiketter och ikoner för
händelsekedjan sätts i `WebsiteView.tsx`.

## CORS

`server.ts` tillåter `https://skylandai.se`, `https://www.skylandai.se`, `https://skyland-ai-os.netlify.app`,
`https://marinmekaniker.nu`, `https://www.marinmekaniker.nu`, `https://coldexperience.se`,
`https://www.coldexperience.se` (+ `EXTRA_CORS_ORIGINS`, kommaseparerad). Tillåtna headers inkluderar
`X-Session-ID` (sajtens `api.js` skickar den) och `X-Skyland-Key`.

CORS avgör bara vem som får anropa. Vilken tenant raden hamnar på avgörs av `site_key` +
`allowed_origins` i `resolveTenant`, inte av CORS-listan. Ett avslag från CORS ger i dag **500**,
inte 403, eftersom middlewaren kastar ett Error — blockerar korrekt men bullrar i loggen.

## Sajtens JS (repo Skyland_AI_System, `app/`)

| Fil | Pekar på |
|---|---|
| `session.js`, `tracker.js`, `void.js`, `dashboard.js` | `https://scc.skylandai.se/api/v1/webhooks/site/{session-init,track-event,void-submission,session-status}` |
| `voice.js` | `PROXY_BASE = https://scc.skylandai.se/api/v1/webhooks/site` → `/voice/signed-url`, `/voice/call-ended` |
| `lang.js` | `AGENT_IDS.sv = agent_8301m19fffmqfcv96zgryg5ey3k5`, `AGENT_IDS.en = agent_4501m19h1g8zfq7v6k6hqh642p32` |

## Röstagenterna

Skapas/uppdateras idempotent med `cd backend && python3 scripts/create_site_agent.py` (läser
`ELEVENLABS_API_KEY` + `LEADS_INTAKE_TOKEN` ur `backend/.env`; **kontrollera att de matchar Render**).
Prompter: `scripts/site_agent_prompt.md` (sv, ordagrant från gamla "Alex 4.0 svenska") och
`scripts/site_agent_prompt_en.md` (en). Röster: sv `1Iztu4UHnTb9SUjJcpS1`, en `EXAVITQu4vr4xnSDxMaL`
(ElevenLabs "Sarah"). LLM gpt-4.1-mini, temp 0.3, `eleven_v3_conversational`. Overrides tillåtna för
`first_message` (konversationsstartare) och `language`.

## Verifierat 2026-09-07 (SCC-51/52)

Fel origin nekas utan att skriva, påhittad nyckel ger 403, Googlebot sparas inte, riktigt anrop
landar på rätt tenant med händelser i rätt ordning och rätt tidsstämplar. Testrader städade.
Skylands 316 sessioner orörda genom hela migrationen. Backend 392 gröna tester, `tsc` rent.

## Verifierat 2026-08-30

Void-formulär end-to-end (RAG-träff 0.56, svenskt svar, poäng, lead i CRM), telemetri från skarpa
sajten, simulerat call-ended (LLM extraherade namn/företag/bransch/mejl/mötesönskan), alla fyra
agent-tools, skarpt röstsamtal (sv) med bokning som landade i Cal.com + SCC-kalendern.
