# Skyland Command Center — Agent Briefing

> Denna fil är till för AI-agenter som hjälper till i utvecklingen av projektet.
> Senast uppdaterad: 2026-07-21

> ## 🧭 BÖRJA HÄR (nuläge, läs först)
> Ny session? Läs dessa i ordning innan du gör något:
> 1. `docs/HANDOVER_2026-07-18.md` — SENASTE läget: hela prospekteringsmaskinen komplett
>    (discover/prospect/dm/batch-pipelines, 52 kort över 7 orter, 47 validerade DM,
>    14 kontaktade, kostnadsstämplar, alla driftläxor). Operatörens jobb: skicka öppnare.
> 2. `docs/HANDOVER_2026-07-13.md` — äldre bakgrund: prospekterings-pipelinens födelse + 37
>    första leads, CRM-kort med score/IG/filter, GHL-MCP-verifiering.
> 2. `docs/HANDOVER-CRM-F1-och-leadlista.md` — bakgrund: F1 CRM-kärnan, affärsmodellen
>    (kursen/MEXPAND), GHL-strategin, öppna beslut.
> 3. `docs/TICKETS_F1_CRM.md` — vad som byggdes i F1.
>
> **Var vi står (2026-07-13):** F1 CRM-kärnan levererad. Ovanpå den finns nu ett **prospekterings-spår**
> för Joakims egen kundanskaffning: ny pipeline **"Prospecting (Agency)"** (8 stages) med **37 riktiga
> tatuerarstudior** (Göteborg + Mölndal) inlagda som contacts + opportunities, berikade (IG/mail/webb)
> och **scorade** (score/tier/booking_flow i `contacts.custom`). CRM-korten visar score/IG/kanal och
> har sort/filter (commits `bb3aa99`, `4d81b4c`, pushade). Nästa: DM-outreach till tier A, ev. skala
> listan mot ~100. Parallellt kvarstår **F2** (utgående e-post/SMS + kalender/bokning).
>
> **Att veta:** externa kopplingar (Supabase-MCP, GHL LeadConnector-MCP, ev. Chrome) måste
> anslutas per session. Git i den mountade `.git` tillåter inte `unlink` — flytta undan
> `*.lock` med `mv` vid behov. Push sker från Joakims egen terminal.

> **VIKTIGT — arkitekturen har ändrats sedan tidigare versioner av denna fil:**
> - Entrypoint är `backend/src/server.ts` (klassbaserad, helmet, CORS, WebSocket-gateway, statisk SPA-servering). `backend/src/index.ts` är LEGACY och körs inte (`package.json` → `dev`/`start` pekar på server.ts).
> - Routing ligger i ~36 modulfiler under `backend/src/routes/` — inte i en stor index.ts.
> - Global Bearer-auth (`middleware/auth.ts`, token `SCC_API_TOKEN`) + rate limiting skyddar `/api/v1/*` sedan 2026-07-09. Öppna undantag: `/health`, `/api-docs`, legacy `/api/skills` + `/api/activities`, samt `/api/v1/leads` (egen token: `LEADS_INTAKE_TOKEN`), `/api/v1/webhooks/openwork` och `/api/v1/voice` (externa anropare — TODO: egen auth).
> - Lead-intake: hemsidan (skyland-ai-os.netlify.app) → n8n Cloud (`onepiecedad.app.n8n.cloud`, void-submission / voice-call-ended) → `POST https://scc.skylandai.se/api/v1/leads/intake`. (OBS: n8n kör på n8n CLOUD — A-posten n8n.skylandai.se pekar på en död server och används inte.)
> - **DEPLOYAD (2026-07-14):** Backend kör i produktion på Render — tjänst `scc`, Frankfurt, Starter, Docker via `backend/Dockerfile` — på `https://scc.skylandai.se` (CNAME → scc-e8x1.onrender.com, TLS via Render). ngrok-tunneln är AVVECKLAD. Auto-deploy vid push till main. Env hanteras i Render-dashboarden. Kill switch för utgående mail: `OUTBOUND_ENABLED=false`. Se `docs/RENDER_DEPLOY.md` + `docs/HANDOVER_2026-07-14.md`.
> - KÄNT SÄKERHETSPROBLEM: `VITE_SCC_API_TOKEN` + `VITE_GATEWAY_TOKEN` bakas in i frontend-bundlen. Behandla dem som publika; riktig användarauth är ett öppet arbete.
> - **DATABAS (rättat 2026-07-12):** Rätt Supabase-projekt är `skyland-command-center`, ref `wfwqjxsuvbacvcmpiesl` (`https://wfwqjxsuvbacvcmpiesl.supabase.co`) — det som backendens `.env` faktiskt pekar på. Den gamla ref:en `sahrizknasraftvqbaor` som förr stod här var INAKTUELL; använd den inte.
> - **KÄNT SÄKERHETSPROBLEM (RLS):** Row Level Security är AVSTÄNGT på alla kärntabeller (`customers, activities, tasks, messages, agent_configs, task_runs, costs, contacts`). Med anon-nyckeln är varje rad läs-/skrivbar. OK så länge SCC är internt bakom Bearer-token, men MÅSTE stängas innan extern kunddata (F4/white-label). Aktivera inte RLS utan policies — det låser all åtkomst direkt.
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
  - `n8n:*` — externa n8n-workflows via webhook
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
- `docs/N8N_CONTRACT.md` — callback-kontrakt för n8n-workflows
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
| Workflows | n8n (extern research) |
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
