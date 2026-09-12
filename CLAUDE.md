# Skyland Command Center — Agent Briefing

> Denna fil är till för AI-agenter som hjälper till i utvecklingen av projektet.
> Senast uppdaterad: 2026-09-12 (annonsflik per kund, Schemalagda jobb speglas från VPS:en, panelkön deployad, ExpandTalk-samarbetet — se HANDOVER_2026-09-11.md)

> ## 🧭 BÖRJA HÄR (läs i den här ordningen)
>
> 1. **`docs/DRIFT.md`** — vad som kör just nu: tjänster, konton,
>    produktionsflaggor, schemalagda jobb, kända skavanker. **Enda sanningen om
>    drift.** Motsäger något annat dokument den här filen, är det andra gammalt.
> 2. **`docs/STABILISERINGSPLAN.md`** — var i planen vi står. Fas 0–3 klara,
>    Fas 4 (volym) pågår.
> 3. **`docs/HANDOVER_2026-09-11.md`** — senaste arbetsdagboken (10–12 sep): annonsfliken,
>    Schemalagda jobb speglade från VPS:en, panelkön (deployad 12 sep), fem fel jag gjorde,
>    och ExpandTalk-samarbetet (kickoff mån 14 sep, motförslag skickat, inget signerat).
>    Föregående: `HANDOVER_2026-09-08.md` (Cold Experience-sekvensen, dagsbudget per domän),
>    `HANDOVER_2026-09-07.md` (webbspårning per kund), `HANDOVER_2026-09-05.md` (autosend).
> 4. **Jobbar du med Cold Experience:** läs `~/.openclaw/skills/scc-crm/references/` FÖRE du
>    kallar något för en bugg. `crm-spegling.md` förklarar varför Het är en ringlista och inte
>    en fas, `mejl-stil-coldexperience.md` varför de mejlen inte är kall utkorg, `gustav-ton.md`
>    rösten. Jag ändrade stegregeln 8 sep utan att ha läst den första, och fick backa.
>
> Behöver du Alex-konfigurationen: `docs/OPENCLAW_CONFIG_INVENTERING.md`.
> Sajtflödena: `docs/SITE_FLOWS.md`. Mejlinfran: `docs/EMAIL_INFRA.md`.
>
> ### Husregel sedan 10 sep: den som har datan pushar
>
> Gatewayn är loopback-bunden på VPS:en, Render står utanför tailnätet. Allt mellan dem går
> VPS → SCC: cron-spegling, annonsdata, minne, och sedan 10 sep en kommandokö
> (`gateway_commands`) för det SCC vill ha utfört. Tre buggar på tre dagar hade samma rot —
> kod skriven för Macen, körd på Render. Bygg aldrig en rutt som antar att Render når in.
>
> ### Var vi står (5 sep 2026)
>
> Reaktiveringskedjan går av sig själv. Ett cronjobb på Alex (02:00) hittar nya
> kliniker, fyller i mejladresser, kör research och DM, och skriver in färdiga
> kort i mejlsekvensen. Öppnaren skickas automatiskt; bump och avslut ligger i
> manuell kö och kräver ett klick i Skuggvecka. Dagstak 20 utskick.
>
> Nästa mätpunkt är **50 skickade öppnare** — före det säger svarsfrekvensen
> ingenting om copyn. Sju utskick är inte ett underlag.
>
> ### Om äldre handovers
>
> `docs/HANDOVER_*.md` är **kronologisk historik, inte nuläge.** Filerna från juli
> och augusti beskriver ett system som delvis inte finns längre: n8n är avvecklat,
> Alex bor på en VPS, pollern kör inte på Macen. Läs dem för bakgrund till ett
> beslut, aldrig för att veta hur något fungerar i dag. Det svaret står i DRIFT.md.
>
> **Att veta när du jobbar här:** git i den mountade `.git` tillåter inte
> `unlink` — ta bort `*.lock` med `rm` från Macens egen terminal vid behov.

> **VIKTIGT — arkitekturen har ändrats sedan tidigare versioner av denna fil:**
> - Entrypoint är `backend/src/server.ts` (klassbaserad, helmet, CORS, WebSocket-gateway, statisk SPA-servering). `backend/src/index.ts` är LEGACY och körs inte (`package.json` → `dev`/`start` pekar på server.ts).
> - Routing ligger i ~36 modulfiler under `backend/src/routes/` — inte i en stor index.ts.
> - Global Bearer-auth (`middleware/auth.ts`, token `SCC_API_TOKEN`, alternativt `?token=` för SSE eller operatörens httpOnly-sessioncookie) + rate limiting skyddar `/api/v1/*` sedan 2026-07-09. **Monterat FÖRE den globala auth:en i `server.ts`, var och en med egen token/signatur (inget är öppet sedan SEC-02..06, 2026-08-10):** `/health`, `/api-docs` (auth-krav i prod), `/api/v1/leads` (`LEADS_INTAKE_TOKEN`), `/api/v1/webhooks/openwork` (`OPENWORK_WEBHOOK_TOKEN`), `/api/v1/voice` (`VOICE_WEBHOOK_TOKEN`), `/api/v1/webhooks/{email,ig-dm,whatsapp,marinmekaniker,site,calcom}` (egna tokens/Meta-signatur), `/api/v1/auth` (login). **Allt annat under `/api/v1`, inklusive `/api/v1/claw/task-result` som Alex callback-skill anropar, kräver `Authorization: Bearer SCC_API_TOKEN`** — det var det som saknades i callback.sh fram till 6 sep.
> - **NULÄGET FÖR DRIFT: läs `docs/DRIFT.md` först.** Den är den enda sanningen om tjänster, konton, flaggor och vad som är avvecklat. Stabiliseringsplan med nästa steg: artefakten "Skyland stabiliseringsplan" (claude.ai) + `docs/HANDOVER_2026-08-30.md`.
> - Lead-intake (sedan 2026-08-30): hemsidan skylandai.se (Netlify `skyland-ai-os`) → **SCC direkt** `/api/v1/webhooks/site/*` (session, telemetri, The Void, röst) → `ingestLead()` in-process. **n8n är avvecklat**, alla workflows portade (`docs/SITE_FLOWS.md`, arkiv i `docs/n8n-archive/`). Röstagenterna ligger i SCC:s ElevenLabs-konto och anropar SCC `/site/agent-tools/*`.
> - **Webbspårningen är flerkundsstöttad sedan 2026-09-07 (SCC-51).** Samma `/api/v1/webhooks/site/*` tar emot från kundsajter; `sessions` och `events` bär `tenant_id`, tenanten avgörs av `site_key` + `allowed_origins` i `resolveTenant()`. Utan nyckel landar raden som skyland, vilket är varför skylandai.se är oförändrad. `website.ts` tar `?tenant=<slug>` och läser tratten ur `tenants.config.webb`; kundkortet har en Hemsida-flik. **Rör inte `customers.tenant_id` för att peka ut en sajt** — den betyder ägare och används av RLS; sajtkopplingen heter `site_tenant_id`. Anslutna: marinmekaniker.nu, coldexperience.se. Läs `docs/SITE_FLOWS.md` innan du ändrar något i intaget.
> - **DEPLOYAD (2026-07-14):** Backend kör i produktion på Render — tjänst `scc`, Frankfurt, Starter, Docker via `backend/Dockerfile` — på `https://scc.skylandai.se` (CNAME → scc-e8x1.onrender.com, TLS via Render). ngrok-tunneln är AVVECKLAD. Auto-deploy vid push till main. Env hanteras i Render-dashboarden. Kill switch för utgående mail: `OUTBOUND_ENABLED=false`. Se `docs/RENDER_DEPLOY.md` + `docs/HANDOVER_2026-07-14.md`.
> - **AUTH-LÄGET (SEC-02..06, 2026-08-10) — läs innan du rör en endpoint.** Fem hål stängdes samma kväll, verifierade mot prod med curl innan fixen:
>   - **`/api/v1/voice/*`** låg HELT oautentiserat mot internet. `POST /voice/tools` når `ask_alex` → gateway `/hooks/agent` med full skill-access + direkta Supabase-frågor. Nu: `VOICE_WEBHOOK_TOKEN` via ny `middleware/sharedSecret.ts`. ElevenLabs skickar headern `x-voice-token`. Escape hatch `VOICE_WEBHOOK_TOKEN_ENFORCED=false` (WARN-logg per anrop, tillfälligt).
>   - **`/api/v1/webhooks/openwork`** låg också helt öppet (POST + GET /events + /status). Nu `OPENWORK_WEBHOOK_TOKEN`.
>   - **Legacy `/api/skills` + `/api/activities`** returnerade data utan auth. Nu bakom `authMiddleware`.
>   - **`/api-docs` + `/api-docs.json`** serverade hela API-kartan publikt i prod. Nu auth-krav i produktion, öppet i dev, `ENABLE_API_DOCS=true` för att öppna medvetet.
>   - **`POST /api/v1/auth/login`** hade bara `globalLimiter` (100/min) = 100 lösenordsgissningar i minuten. Nu `loginLimiter`: 5 försök/15 min/IP, `skipSuccessfulRequests`.
>   - **Gateway-token roterad** — den gamla serverades publikt i JS-bundlen och är att betrakta som läckt. Ny token i `openclaw.json`, agent-skill-doc, `openclaw-config/.env`, `frontend/.env*`, `backend/.env`. Kräver `deploy_openclaw_config.sh` + omstart av gatewayen + Render-env.
>   - Tester: `__tests__/sharedSecretAuth.test.ts` (18) + `loginLimiter.test.ts` (2). Hela sviten 209/209 grön, `tsc --noEmit` rent.
> - **Rättelse av gammal not:** `VITE_SCC_API_TOKEN` bakas INTE in i produktionsbundlen — kontrollerat genom att ladda ner och grepa alla tre JS-filerna från scc.skylandai.se. Frontenden kör redan cookie-only (`/api/v1/auth/login`, httpOnly, SameSite=Lax). Raden är borttagen ur `frontend/.env.production` så den inte kan smyga tillbaka. **Kvarstår medvetet:** `VITE_GATEWAY_TOKEN` ligger i bundlen, eftersom browsern pratar direkt med OpenClaw-gatewayen. Skadan begränsas av att gatewayen är loopback-bunden och att Tailscale-funnel-URL:en är borttagen ur `.env.production`. Rätt slutläge är att backenden proxar WebSocket:en och håller token serverside — **eget ticket, ej gjort.**
> - **ÖPPET MEDVETET:** `POST /api/v1/leads/web` är publik (landningssidornas formulär), skyddad av `webIntakeLimiter` 6/min/IP. `/health` är öppen. Rör inte utan att förstå varför.
> - **DATABAS (rättat 2026-07-12):** Rätt Supabase-projekt är `skyland-command-center`, ref `wfwqjxsuvbacvcmpiesl` (`https://wfwqjxsuvbacvcmpiesl.supabase.co`) — det som backendens `.env` faktiskt pekar på. Den gamla ref:en `sahrizknasraftvqbaor` som förr stod här var INAKTUELL; använd den inte.
> - **RLS ÄR PÅSLAGET (SEC-01, 2026-08-10) — det gamla säkerhetsproblemet är löst.** Row Level Security är nu aktiverat med policies på samtliga 19 kärntabeller + de nya `ce_`-tabellerna. Mönstret: `anon` = total spärr (restrictive `USING (false)`), `authenticated` = tenant-isolering via `current_tenant_id()` där `tenant_id` finns (`customers, contacts, opportunities, pipelines, bookings`) och total spärr där den inte finns, `service_role` = bypassar RLS. **Backenden kör som `service_role` och påverkas inte** — allt DB-arbete från Express fortsätter som förut. Migration: `database/migrations/sec01_rls_legacy_tables.sql`, rollback: `sec01_rollback.sql`. Supabase security advisor gick från 20 fynd till 1 (extension `vector` i public — medvetet kvar, se filens slut). **Skriver du ny kod som pratar med Supabase: använd service-role-klienten i `backend/src/services/supabase.ts`. Anon-nyckeln ger noll rader, by design.**
> - **DÖD KOD att känna till (upptäckt vid SEC-01):** `frontend/src/services/realtime.ts` och `backend/src/services/supabaseRealtime.ts` prenumererar på postgres_changes — men publikationen `supabase_realtime` innehåller NOLL tabeller, `VITE_SUPABASE_ANON_KEY` saknas i `frontend/.env.production`, och ingen komponent anropar `subscribeToActivities`/`subscribeToSkills`. Realtime har alltså aldrig streamat något i prod. Riv eller återuppliv medvetet — men återuppliv i så fall via backendens WebSocket-gateway, inte via anon-nyckel mot Supabase.
> - **F1 CRM-kärnan LEVERERAD (2026-07-12, commit `feat(crm): F1 core`):** Nya tabeller `contacts`, `pipelines`, `stages`, `opportunities` (migrations `ticket22_contacts.sql`, `ticket24_pipelines.sql`, applicerade). Lead-intake upsertar nu en contact. Nya routes `contacts.ts` + `pipelines.ts`. Nya Alex-verktyg: `get_contact`, `list_contacts`, `move_opportunity`, `log_interaction`. Frontend: CRM-flik (kanban + unified inbox). Se `docs/TICKETS_F1_CRM.md`. Leads lagras fortfarande ÄVEN som activities (audit) — men contacts är nu den queryabla entiteten.

---

> **Om resten av den här filen (omskriven 12 sep 2026).** Allt nedanför är nuläge per
> 12 sep. Den gamla texten beskrev v1 MVP från juli: "Master Brain", n8n som exekutor, tre
> kunder, fem verktyg, 187 tester. Inget av det stämde längre. Nulägesdetaljer om drift står
> fortfarande bara i `docs/DRIFT.md`; det här är kartan, inte terrängen.

## Vad är det här?

Skyland Command Center (SCC) är Joakims operatörsverktyg för att driva Skyland AI Solutions:
CRM, utskickssekvenser, lead-intag från sajter och Meta, kundkort med hemsida- och
annonsflikar, arkiv för rapporter, och kontrollrum för AI-agenten Alex. Frontenden har en
3D-vy (Realm3D) men den är en del av UI:t, inte hela.

**Operatör:** Joakim (ensam). Ingen annan användare finns.

**Två Alex, inte en:**

| | Server-Alex | Gateway-Alex |
|---|---|---|
| Kod | `backend/src/services/alexBrain.ts` | OpenClaw på VPS:en `alex@62.238.113.151`, 123 skills |
| Kör på | Render | VPS:en |
| Äger | CRM-verktygen, skärmen (SSE `ui_action`), rösten i SCC | WhatsApp, cron-jobben, minnet, research, utskick |
| Pratar med | Supabase direkt | SCC:s API med `SCC_API_TOKEN` (skill `scc-crm`) |

"Master Brain" var det gamla namnet på server-Alex. Ordet finns kvar i `agent_configs` och
någon kommentar; det betyder samma sak.

## Vad som kör (kort — DRIFT.md har detaljerna)

**Backend** (Express 5 + TypeScript, Render, `https://scc.skylandai.se`): 59 rutt-moduler under
`backend/src/routes/`, global Bearer/cookie-auth, SSE-hubb för skärmstyrning, WebSocket-gateway.
Dispatchern kör `local:echo` och `claw:*`. **`n8n:*`-grenarna i `taskService.ts` är död kod**
(n8n avvecklat 30 aug) och kan rivas; rör dem inte annat än för att ta bort dem.

**Frontend** (React 19 + Vite 7): flikarna Alex, Försäljning (CRM, Skuggvecka, Sekvenser,
Leads), Kunder (kundkort med Hemsida- och Annonser-flik), Innehåll, System (Schemalagda jobb,
integrationshälsa, kostnader). Flytande Alex-panel med röst, minimerbar.

**Databas** (Supabase `wfwqjxsuvbacvcmpiesl`, RLS på, backend som `service_role`):

| Område | Tabeller |
|---|---|
| CRM | `contacts`, `opportunities`, `pipelines`, `stages`, `customers` (+ vyn `customer_status`) |
| Sekvenser | `sequences`, `sequence_steps`, `enrollments`, `messages` |
| Cold Experience | `ce_leads`, `ce_messages`, `ce_lead_events`, `ce_settings` — **källan**, speglas till CRM via `ce_mirror_*` |
| Sajt | `tenants`, `sessions`, `events` (flerkund via `tenant_id`) |
| Annonser | `meta_ads_daily` (kampanj/dag, från VPS:en) och `ad_performance` (annonsnivå, edge-funktion) — två vägar, ska bli en |
| Agent | `tasks`, `task_runs`, `activities`, `deliverables`, `agent_memory`, `gateway_cron_jobs`, `gateway_commands` |
| Övrigt | `costs`, `bookings`, `mk_*` (mäklarvertikalen) |

**VPS → SCC, aldrig tvärtom.** Gatewayn är loopback-bunden; Render står utanför tailnätet.
Allt som SCC behöver från VPS:en pushas dit (`cron_sync.py`, `meta_ads_sync.py`,
`sync_memory.py`) och allt SCC vill ha utfört köas (`gateway_commands`, dräneras varje minut).

## Alex verktyg (`backend/src/llm/tools.ts`, 25 st)

| Grupp | Verktyg |
|---|---|
| Läsa | `get_customer_status`, `get_customer_errors`, `list_recent_activities`, `get_crm_stats`, `get_site_stats`, `get_ads_stats`, `get_credits`, `list_open_tasks` |
| CRM | `get_contact`, `list_contacts`, `update_contact`, `list_opportunities`, `move_opportunity`, `log_interaction`, `find_prospects` |
| Sekvenser | `list_sequences`, `enroll_in_sequence`, `schedule_followup` |
| Skärm | `navigate_ui`, `present_screens` (steg utan mål ärver föregående skärm) |
| Delegera | `delegate_task` (till gateway-Alex via claw-kön), `bestall_utredning` (rapport till arkivet), `produce_package`, `create_task_proposal` |
| Meta | `report_capability_gap` |

Nya verktyg: definition + handler i `tools.ts`, test i `tools.test.ts`. Allt som påverkar
omvärlden går via `create_task_proposal` (status `review`) — se AGENT_POLICY.

## Regler (AGENT_POLICY, oförändrade)

1. **Projektisolering** — varje operation tillhör en kund (`customer_id`).
2. **Charter First** — kundens mål, scope och guardrails i `customers.config`.
3. **SUGGEST som standard** — det som påverkar en kund skapas som review-task.
4. **Inget externt utan godkännande** — mejl, SMS, WhatsApp, bokningar. Undantag är de
   flöden som uttryckligen släppts i DRIFT.md (öppnaren i reaktiveringen, Gustav-roboten).
5. **Allt loggas** — activities, messages, actions_taken.
6. **Säkerhet före fart** — osäker? skapa en review-task.

Autonominivåer: OBSERVE (läs), SUGGEST (föreslå, kräver ok), ACT (utför godkänt), SILENT (intern housekeeping).

## Kunder (`customers`, 12 sep 2026)

| Slug | Namn | Sajt spårad | Annonsflik |
|---|---|---|---|
| `gustav` | Cold Experience | ja | ja (`config.meta`, token på VPS:en) |
| `thomas` | MarinMekaniker | ja | nej |
| `gkmk` | Göteborgs Krav Maga Klubb | nej | blockerad (ingen app i deras Meta-portfölj) |
| `axel` | Hasselblads Livs | nej | nej |
| `allgold` | All Gold Tattoo | nej | nej |

`tenants` är ett parallellt register (7 rader) som sajtspårningen och `ce_leads` använder.
De överlappar delvis med `customers`. Rör inget av dem "för att städa" utan ett beslut om
vilket som är sanningen — se DRIFT, Kända skavanker.

## Repo och struktur

```
skyland-command-center/
├── backend/src/
│   ├── server.ts            # entrypoint (index.ts är legacy, körs inte)
│   ├── routes/              # 59 moduler, en per API-område
│   ├── services/            # alexBrain, sequenceRunner, comms, email, integrationHealth …
│   ├── middleware/          # auth, rateLimiter, sharedSecret
│   └── llm/                 # adapter + tools.ts + systemPrompt
├── frontend/src/            # App.tsx, api.ts, pages/, components/, navigation/
├── database/migrations/     # applicerade via Supabase MCP; filen är facit, inte körordning
├── docs/                    # DRIFT.md (nuläge), HANDOVER_*.md (historik), SITE_FLOWS, EMAIL_INFRA …
├── maklare/                 # mäklarvertikalen (HusmanHagberg/Bjurfors, ElevenLabs-agent), committad 12 sep
├── scripts/                 # drift_check.py m.fl.
└── sales/                   # säljunderlag med media — GITIGNORERAD (55 MB), bara på disk
```

**Andra repon:** `openclaw-config` (Alex konfiguration, skills, VPS-skript; ligger i
`~/openclaw-config` på VPS:en och deployas med `deploy_vps.sh`), `Skyland_AI_System`
(sajten skylandai.se, Netlify), `ColdExperience` och `MarinMekaniker` (kundsajter).

## Miljövariabler

Backend-flaggorna i produktion ligger i Render och är listade i `docs/DRIFT.md` under
Produktionsflaggor; kopiera inte listan hit, den driver isär. Lokalt: `backend/.env` med
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SCC_API_TOKEN`, `LLM_PROVIDER=openrouter`,
`LLM_MODEL`, `OPENROUTER_API_KEY`, `OPENCLAW_HOOK_URL`, `OPENCLAW_HOOK_TOKEN`. Allt som
heter `N8N_*` är dött. Meta-tokens ligger inte i backend alls; de bor på VPS:en.

## Testning & CI

Backend: vitest, **52 suiter, 497 tester** (12 sep). `npm test` i `backend/`. Mock-mönster:
per-tabell-FIFO via `vi.hoisted` eller `src/__tests__/helpers/mockSupabase.ts` för supertest.
Test-env sätts i `src/tests/setup.ts`. Frontend: vitest + testing-library, komponent-smokes;
`tsc` är rött enbart i `*.test.tsx` (jest-dom-typer saknas), `vite build` grönt. E2E:
Playwright i `frontend/e2e/`, inte i CI. CI: GitHub Actions vid varje push. **Bryt inte gröna
tester.** Kända röda: `routes/skills.test.ts` (två tester slår mot riktig DB).

## Att tänka på när du jobbar här

1. **Läs DRIFT.md först.** Motsäger något annat dokument den, är det andra gammalt.
2. **Git mot repot går genom Desktop Commander, inte `device_bash`.** Det senare skalet får
   inte radera filer, så varje skrivande git-kommando lämnar en `.lock` som blockerar nästa.
   Från en molnsession: commit i molnklonen → `git format-patch` → fil till `_to_delete/` på
   Macen → `git am` + `git push` via Desktop Commander → `git reset --hard origin/main` i molnet.
3. **VPS → SCC, aldrig tvärtom.** Se ovan. En rutt som antar att Render når gatewayn kommer
   att fungera i utveckling och tyst fela i prod.
4. **Displayer får inte ljuga.** `null` betyder "vet inte", `0` betyder noll. En panel som
   inte kan nå sin källa ska säga det, inte visa tomt. Tre buggar 10–12 sep var den familjen.
5. **Cold Experience-mekaniken står i `~/.openclaw/skills/scc-crm/references/`.** Läs
   `crm-spegling.md` innan du kallar något där för en bugg.
6. **Inget skickas till en riktig gäst i Cold Experience-sekvensen** förrän Joakim stämt av
   med Gustav. Sekvensen står i draft med noll inskrivna, med flit.
7. **`customer_status` är en VIEW.** Ändra aldrig status för hand.
8. **Commit-stil:** en rubrik som säger vad som ändrades och varför, på svenska, som i loggen.
   Prefix som `feat(scope):` förekommer i äldre historik men är inte kravet.
9. **Skriv en handover när dagen är slut** (`docs/HANDOVER_ÅÅÅÅ-MM-DD.md`) och peka på den
   från BÖRJA HÄR ovan. Skriv felen du gjorde i klartext; det är de som sparar tid nästa gång.
