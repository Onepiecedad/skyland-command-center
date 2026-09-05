# Skyland Command Center — Agent Briefing

> Denna fil är till för AI-agenter som hjälper till i utvecklingen av projektet.
> Senast uppdaterad: 2026-09-05

> ## 🧭 BÖRJA HÄR (läs i den här ordningen)
>
> 1. **`docs/DRIFT.md`** — vad som kör just nu: tjänster, konton,
>    produktionsflaggor, schemalagda jobb, kända skavanker. **Enda sanningen om
>    drift.** Motsäger något annat dokument den här filen, är det andra gammalt.
> 2. **`docs/STABILISERINGSPLAN.md`** — var i planen vi står. Fas 0–3 klara,
>    Fas 4 (volym) pågår.
> 3. **`docs/HANDOVER_2026-09-05.md`** — senaste arbetsdagboken (3–5 sep):
>    autosend-beslutet, den nattliga påfyllnaden, doktrin- och stadiegrinden.
>
> Behöver du Alex-konfigurationen: `docs/OPENCLAW_CONFIG_INVENTERING.md`.
> Sajtflödena: `docs/SITE_FLOWS.md`. Mejlinfran: `docs/EMAIL_INFRA.md`.
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
> - Global Bearer-auth (`middleware/auth.ts`, token `SCC_API_TOKEN`) + rate limiting skyddar `/api/v1/*` sedan 2026-07-09. Öppna undantag: `/health`, `/api-docs`, legacy `/api/skills` + `/api/activities`, samt `/api/v1/leads` (egen token: `LEADS_INTAKE_TOKEN`), `/api/v1/webhooks/openwork` och `/api/v1/voice` (externa anropare — TODO: egen auth).
> - **NULÄGET FÖR DRIFT: läs `docs/DRIFT.md` först.** Den är den enda sanningen om tjänster, konton, flaggor och vad som är avvecklat. Stabiliseringsplan med nästa steg: artefakten "Skyland stabiliseringsplan" (claude.ai) + `docs/HANDOVER_2026-08-30.md`.
> - Lead-intake (sedan 2026-08-30): hemsidan skylandai.se (Netlify `skyland-ai-os`) → **SCC direkt** `/api/v1/webhooks/site/*` (session, telemetri, The Void, röst) → `ingestLead()` in-process. **n8n är avvecklat**, alla workflows portade (`docs/SITE_FLOWS.md`, arkiv i `docs/n8n-archive/`). Röstagenterna ligger i SCC:s ElevenLabs-konto och anropar SCC `/site/agent-tools/*`.
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

## Vad är det här?

Skyland Command Center (SCC) är ett internt operatörsverktyg för att styra och övervaka ett ekosystem av AI-agenter och kunder. Tänk det som ett kontrollrum i rymden: en 3D-hexagondisk där varje struktur representerar antingen en intern modul (t.ex. Research Lab, Content Workshop) eller en kundinstans (Thomas, Axel, Gustav).

**Operatör:** Joakim (ägare av Skyland-ekosystemet)

**Kärnan:** En AI som kallas "Master Brain" sitter i mitten och koordinerar allt — den kan svara på frågor, kolla kundstatus, föreslå uppgifter och delegera till sub-agenter.

---

## Vad har vi byggt hittills (v1 MVP — alla core tickets klara)

### Backend (Express + TypeScript, port 3001)
- REST API med 20+ endpoints under `/api/v1`
- Supabase (PostgreSQL) som databas — kärntabeller + CRM-tabeller (contacts/pipelines/stages/opportunities) + customer_status-view
- Master Brain AI-chat med intent-klassificering och tool calling
- Task-system med approve-flöde (SUGGEST → review → approve → dispatch)
- Dispatcher som kan köra uppgifter via:
  - `local:echo` — lokal test-executor
  - `n8n:*` — (legacy, n8n avvecklat 2026-08-30)
  - `claw:*` — OpenClaw sub-agenter via hook
- LLM-adapter med stöd för **OpenAI**, **DeepSeek** och **OpenRouter** (500+ modeller via en nyckel)

### Frontend (React 19 + Three.js, port 5173)
- 3D-hexagondisk med kundsfärer (klickbara, färgkodade efter status)
- Dashboard med: kundlista, aktivitetslogg, task-kö, Master Brain-chat
- System Monitor med run-historik och task-detaljer
- Mörkt tema med glassmorphism-stil

### Databas (Supabase / PostgreSQL)
- `customers` — kunder med config (charter, mål, scope)
- `activities` — audit log för allt som händer (agent, severity, autonomy_level)
- `tasks` — uppgifter med hierarki (parent_task_id), executor och approve-flöde
- `messages` — chatthistorik (alla kanaler: chat, voice, email, webhook...)
- `agent_configs` — agentregistret (Master Brain konfigurerad)
- `customer_status` — VIEW som härleder kundstatus automatiskt (error/warning/active)

### Dokumentation
- `SPEC.md` — fullständig v1.1-specifikation
- `docs/AGENT_POLICY.md` — säkerhetspolicy för agenter
- `docs/DRIFT.md` — vad som kör just nu (enda sanningen)
- `docs/SITE_FLOWS.md` — sajtens flöden i SCC (ersätter n8n)
- `docs/N8N_CONTRACT.md` — (legacy) callback-kontrakt för n8n-workflows
- `docs/OPENCLAW_HOOK_SCC_DISPATCH.md` — OpenClaw-integration
- `logg.md` — utvecklingslogg (alla tickets)

---

## Tech Stack

| Lager | Teknologi |
|-------|-----------|
| Frontend | React 19 + TypeScript 5.9 + Vite 7 |
| 3D | Three.js + react-three-fiber |
| Backend | Express 5 + TypeScript |
| Databas | Supabase (PostgreSQL) |
| AI/LLM | OpenRouter (rekommenderat) → OpenAI, DeepSeek, Anthropic, 500+ modeller |
| Workflows | (n8n avvecklat 2026-08-30 — flöden ligger i SCC-routes) |
| Sub-agenter | OpenClaw |

---

## Hur LLM-lagret fungerar

Vi har ett adapter-mönster i `backend/src/llm/`:

```
LLM_PROVIDER env → adapter.ts factory → OpenAI / DeepSeek / OpenRouter adapter
```

- **OpenRouter är rekommenderat** — en enda API-nyckel ger tillgång till alla modeller
- Modellval via `LLM_MODEL` env var (t.ex. `openai/gpt-4o`, `anthropic/claude-sonnet-4-5-20250929`)
- Alla adapters använder OpenAI-kompatibelt format (`openai` npm-paket)
- Tool calling (function calling) stöds av alla adapters

### Master Brain verktyg (tools.ts)

| Verktyg | Vad det gör |
|---------|------------|
| `get_customer_status` | Hämtar kundstatus från customer_status-view |
| `get_customer_errors` | Hämtar fel och varningar för diagnostik |
| `list_recent_activities` | Listar aktivitetshistorik |
| `create_task_proposal` | Skapar task med status=review (kräver godkännande) |
| `list_open_tasks` | Listar öppna uppgifter |

---

## Regler att följa (AGENT_POLICY)

1. **Projektisolering** — Varje operation tillhör en kund (`customer_id`). Ingen kund = inga externa effekter.
2. **Charter First** — Varje kund har en charter i `customers.config` med mål, scope och guardrails.
3. **SUGGEST som standard** — Allt som påverkar en kund skapas som SUGGEST-task (status `review`) och kräver godkännande.
4. **Inget externt utan godkännande** — Mail, SMS, WhatsApp, bokningar = alltid SUGGEST i v1.
5. **Allt loggas** — Activities, messages, actions_taken. Om det hände ska det vara synligt.
6. **Säkerhet före fart** — Osäker? Fråga. Skapa en review-task istället för att gissa.

### Autonominivåer

| Nivå | Betydelse | Kräver godkännande |
|------|-----------|-------------------|
| OBSERVE | Läs och analysera | Nej |
| SUGGEST | Föreslå (skapar review-task) | Ja |
| ACT | Utför godkänd åtgärd | Nej (redan godkänd) |
| SILENT | Intern housekeeping | Nej |

---

## Projektstruktur

```
skyland-command-center/
├── backend/
│   └── src/
│       ├── index.ts              # Express-app, alla routes
│       ├── services/supabase.ts  # Supabase-klient
│       └── llm/
│           ├── adapter.ts        # Provider-interface + factory
│           ├── openaiAdapter.ts
│           ├── deepseekAdapter.ts
│           ├── openrouterAdapter.ts  ← NY
│           ├── systemPrompt.ts   # Dynamisk systemprompt
│           └── tools.ts          # Tool definitions + handlers
├── frontend/
│   └── src/
│       ├── App.tsx               # Huvud-layout
│       ├── api.ts                # API-klient + typer
│       └── components/
│           ├── Realm3D.tsx       # 3D-hexagondisk
│           ├── CustomerList.tsx
│           ├── ActivityLog.tsx
│           ├── MasterBrainChat.tsx
│           ├── PendingApprovals.tsx
│           ├── TaskDetail.tsx
│           ├── TaskProgressSection.tsx
│           └── RunLogPanel.tsx
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
├── docs/
│   ├── AGENT_POLICY.md
│   ├── N8N_CONTRACT.md
│   └── OPENCLAW_HOOK_SCC_DISPATCH.md
├── SPEC.md                       # Fullständig specifikation
└── logg.md                       # Utvecklingslogg
```

---

## Miljövariabler (backend/.env)

```bash
# Databas
SUPABASE_URL=https://wfwqjxsuvbacvcmpiesl.supabase.co   # projekt: skyland-command-center
SUPABASE_SERVICE_ROLE_KEY=<hemlig>

# Server
PORT=3001

# LLM (välj EN provider)
LLM_PROVIDER=openrouter        # openai | deepseek | openrouter
LLM_MODEL=openai/gpt-4o        # modellnamn (OpenRouter: provider/modell)
OPENROUTER_API_KEY=<hemlig>     # Rekommenderat — en nyckel, alla modeller

# Direktnycklar (om du INTE använder OpenRouter)
OPENAI_API_KEY=<hemlig>
DEEPSEEK_API_KEY=<hemlig>

# Integrations
N8N_WEBHOOK_URL=<webhook-url>
OPENCLAW_HOOK_URL=<hook-url>
OPENCLAW_HOOK_TOKEN=<hemlig>
SCC_PUBLIC_BASE_URL=<publik URL för callbacks>
```

---

## Kunder (nuvarande)

| Namn | Slug | Beskrivning |
|------|------|-------------|
| Thomas — MarinMekaniker | `thomas` | Marinmekaniker-verksamhet |
| Axel — Hasselblads Livs | `axel` | Livsmedelsbutik |
| Gustav — Cold Experience | `gustav` | Upplevelse-/eventföretag |

---

## Vad som återstår / nästa steg

### Klart (v1 MVP)
- Alla core tickets (1-21) ✅
- Backend API komplett
- Frontend dashboard med 3D
- Master Brain AI med tool calling
- Task approve/dispatch-flöde
- n8n + OpenClaw integration
- OpenRouter-adapter (multi-modell)

### Möjliga nästa steg (v2+)
- Sub-agenter med egen UI (Research, Content, Dev, Comms)
- Proaktiva triggers (agenter agerar utan prompt)
- Kundinstanser med egen dashboard (klickbar i 3D)
- Röst-input/output (Web Speech API + ElevenLabs)
- Docker/deployment-konfiguration
- The Stream (realtidsdata-flöde)
- Energilinjer mellan strukturer i 3D

> **Tester + CI/CD är LEVERERAT (2026-07-21)** — se avsnittet "Testning & CI" nedan.

---

## Testning & CI (levererat 2026-07-21)

Testinfran påstods tidigare saknas helt. Det stämmer INTE längre — den var delvis
trasig (4 HTTP-suiter kraschade pga saknad `supertest`) och är nu lagad + kraftigt utbyggd.

- **Backend:** vitest, ~187 tester över 27 suiter. Kör `npm test` i `backend/`. Täcker de
  högsta riskytorna: utskicksgrind (`comms`/`sequenceRunner` — kill switch + dagsbudget),
  dispatch-policy & routing (`taskService`), claw-rate-limits, sekvens-triggrar (drip-stopp),
  CRM dedupe/merge, webhook-token-auth (leads/email/igDm/calcom), LLM-verktygslager +
  adapter-parsing, samt route-lagret (auth/validering/404).
- **Frontend:** vitest + `@testing-library` (jsdom), komponent-smokes. Kör `npm test` i
  `frontend/`. Vitest är begränsad till `src/**` (se `vite.config.ts`) — `e2e/` ägs av Playwright.
- **E2E:** Playwright (`frontend/e2e/`, `playwright.config.ts`). Kör `npm run test:e2e`
  (kräver backend igång + `E2E_PASSWORD`). Se `frontend/e2e/README.md`. Ingår INTE i CI än.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) kör backend + frontend vid varje push/PR.

**Mock-mönster:** supabase mockas per testfil — vanligast en "per-tabell-FIFO" (`vi.hoisted`
state + `from(table)` som köar svar), eller `src/__tests__/helpers/mockSupabase.ts` för
HTTP-tester (supertest). Test-env/token sätts i `src/tests/setup.ts` (global setupFile) —
lägg nya test-env-vars DÄR, inte i `.env`. **Bryt aldrig gröna tester; CI gatekeepar.**

---

## Att tänka på när du jobbar med koden

1. **Backend-filen `index.ts` är stor (~2300 rader)** — all routing ligger i en fil. Hantera med omsorg.
2. **Tester finns nu (~190 st) + CI** — kör `npm test` i `backend/` och `frontend/` innan du pushar; GitHub Actions kör dem vid varje push. Se avsnittet "Testning & CI". Bryt inte gröna tester.
3. **Inga node_modules i repot** — kör `npm install` i både `backend/` och `frontend/` först.
4. **Supabase-credentials krävs** — utan `.env` med rätt nycklar startar inte backend.
5. **customer_status är en VIEW** — den beräknas automatiskt från activities + tasks. Ändra aldrig status manuellt.
6. **Tasks med status `review`** = väntar på godkännande. Skippa aldrig approve-steget.
7. **Commit-stil:** `feat(scope): beskrivning` — se git log för exempel.
