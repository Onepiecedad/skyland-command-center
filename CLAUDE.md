# Skyland Command Center — Agent Briefing

> Denna fil är till för AI-agenter som hjälper till i utvecklingen av projektet.
> Senast uppdaterad: 2026-02-07

---

## Vad är det här?

Skyland Command Center (SCC) är ett internt operatörsverktyg för att styra och övervaka ett ekosystem av AI-agenter och kunder. Tänk det som ett kontrollrum i rymden: en 3D-hexagondisk där varje struktur representerar antingen en intern modul (t.ex. Research Lab, Content Workshop) eller en kundinstans (Thomas, Axel, Gustav).

**Operatör:** Joakim (ägare av Skyland-ekosystemet)

**Kärnan:** En AI som kallas "Master Brain" sitter i mitten och koordinerar allt — den kan svara på frågor, kolla kundstatus, föreslå uppgifter och delegera till sub-agenter.

---

## Vad har vi byggt hittills (v1 MVP — alla core tickets klara)

### Backend (Express + TypeScript, port 3001)
- REST API med 20+ endpoints under `/api/v1`
- Supabase (PostgreSQL) som databas med 5 tabeller + 1 view
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
SUPABASE_URL=https://sahrizknasraftvqbaor.supabase.co
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
- CI/CD pipeline (saknas helt)
- Tester (inga .test.ts-filer finns)
- Docker/deployment-konfiguration
- The Stream (realtidsdata-flöde)
- Energilinjer mellan strukturer i 3D

---

## Att tänka på när du jobbar med koden

1. **Backend-filen `index.ts` är stor (~2300 rader)** — all routing ligger i en fil. Hantera med omsorg.
2. **Inga tester finns** — var extra noggrann med att inte bryta befintlig funktionalitet.
3. **Inga node_modules i repot** — kör `npm install` i både `backend/` och `frontend/` först.
4. **Supabase-credentials krävs** — utan `.env` med rätt nycklar startar inte backend.
5. **customer_status är en VIEW** — den beräknas automatiskt från activities + tasks. Ändra aldrig status manuellt.
6. **Tasks med status `review`** = väntar på godkännande. Skippa aldrig approve-steget.
7. **Commit-stil:** `feat(scope): beskrivning` — se git log för exempel.
