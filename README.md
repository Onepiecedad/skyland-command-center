# Skyland Command Center (SCC) - Project Setup Documentation

This document outlines the current configuration and key components of your Skyland Command Center (SCC) setup, managed by Alex, your AI assistant.

## 1. Environment & Core Setup

- **Operating System:** macOS (as detected by Alex)
- **Node.js Version:** v24.13.0 (managed via nvm)
- **OpenClaw Executable Path:** `/Users/onepiecedad/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/bin/openclaw`
- **Gateway Process Manager:** PM2 (managed by `launchd` for autostart)

## 2. OpenClaw Model Routing Strategy (Cost Optimized)

Alex has implemented a 3-tier model routing strategy to optimize costs and balance performance, configured in `.openclaw/openclaw.json`:

- **Primary Default Model:** `openrouter/google/gemini-2.5-flash` (for general communication, low cost)

### Routing Tiers:

| Tier    | Model                        | Max Tokens | Use Case                                            | Estimated Cost / 1M Input Tokens | Note               |
|---------|------------------------------|------------|-----------------------------------------------------|----------------------------------|--------------------|
| **Tier 1** | `gemini-2.5-flash`           | 2,000      | Greetings, simple questions, status checks, memory search (cheapest) | $0.00015                       | Default for routine tasks |
| **Tier 2** | `moonshotai/kimi-k2.5`       | 8,000      | Code generation, analysis, research, file operations, web search, tool execution | $0.45                         | Medium complexity  |
| **Tier 3** | `anthropic/claude-sonnet-4-20250514` | 16,000     | Complex problem solving, architecture, debugging, strategic planning, multi-step workflows, code review (most capable) | $3.00                         | Complex / advanced |

This strategy is designed to route tasks to the most cost-effective model suitable for the job, aiming for significant cost reductions.

## 3. Skyland Command Center (SCC) - Custom Features

> **Uppdaterad 2026-07-12:** SCC har fått en CRM-kärna (F1). Se `docs/TICKETS_F1_CRM.md`
> och `docs/HANDOVER-CRM-F1-och-leadlista.md` för detaljer.

Your SCC dashboard (`skyland-command-center/frontend/`) includes several custom-built components and integrations:

- **🗂️ CRM (F1 — contacts, pipeline, unified inbox):**
  - **Purpose:** Ägd CRM-datamodell så leads blir hanterbara entiteter, inte loggrader. Ersätter behovet av GHL för CRM.
  - **Location:** CRM-flik, `CrmView.tsx` (`PipelineBoard.tsx` + `ConversationInbox.tsx`). Backend: `routes/contacts.ts`, `routes/pipelines.ts`, `services/contacts.ts`.
  - **Features:** normaliserade contacts (lead-intake upsertar), drag-bar kanban över pipeline-stages, tråd-per-kontakt över alla kanaler, Alex CRM-verktyg (`get_contact`, `list_contacts`, `move_opportunity`, `log_interaction`).

- **💡 Idéer (Project Ideas Management):**
  - **Purpose:** Centralized system to capture, track, and manage project ideas and tasks.
  - **Location:** `/ideas` route, `IdeasView.tsx` component.
  - **Features:** CRUD operations, status tracking, categorization, tag support, React Query integration.

- **🎙️ Röstchat (ElevenLabs Voice Interface):**
  - **Purpose:** Real-time two-way voice communication with Alex via ElevenLabs Conversational AI.
  - **Location:** `/voice` route, `VoiceChatView.tsx` component (`VoiceChat.tsx` core).
  - **Features:** WebRTC connectivity, real-time transcription, integrated tool calling (via `backend/src/routes/voice.ts`), customizable voice (Swedish).
  - **Status:** Requires manual ElevenLabs agent configuration (webhook URL, JSON schema) and API key setup in `.env`.

- **📊 Context & Cost Monitor:**
  - **Purpose:** Real-time monitoring of AI token usage, estimated costs, and context pressure per session.
  - **Location:** Integrated into the `SystemDashboard.tsx` via `ContextMonitor.tsx` component.
  - **Features:** Overview cards (total cost/tokens, context pressure), active session list, configurable model pricing (`public/config/pricing.json`), context usage bar with alerts.

- **🖼️ Alex Avatars:**
  - **Purpose:** Customizable visual representation for Alex within the SCC dashboard.
  - **Location:** `/frontend/public/avatars/` with selector in `AlexView.tsx`.
  - **Avatars:**
    - `alex-avatar.svg`: Professional, tech-assistant style.
    - `ai-influencer-avatar.svg`: Energetic, pedagogical, social media-oriented.
    - `alex-cyborg-feminin.svg` (S.E.L.F.): Futuristisk, feminine cyborg style.

## 4. Key Configuration Files

- **`.openclaw/openclaw.json`:** Core OpenClaw configuration, including global model routing, agent-specific overrides, API providers, and various settings.
- **`skyland-command-center/frontend/public/config/pricing.json`:** Custom pricing definitions for models used in the Context & Cost Monitor.
- **`skyland-command-center/frontend/.env`:** Environment variables for frontend (e.g., ElevenLabs API keys, SCC Backend URL).

## 4b. Testning & CI (levererat 2026-07-21)

- **Backend:** `cd backend && npm test` — vitest, ~187 tester över 27 suiter (utskicksgrind,
  dispatch-policy/routing, claw-rate-limits, sekvens-triggrar, CRM dedupe/merge, webhook-auth,
  LLM-verktyg/adapter, route-lagret). Test-env sätts i `backend/src/tests/setup.ts`.
- **Frontend:** `cd frontend && npm test` — vitest + `@testing-library` (jsdom), komponent-smokes
  i `src/`. Vitest är begränsad till `src/**` (se `vite.config.ts`).
- **E2E:** `cd frontend && npm run test:e2e` — Playwright (login→CRM + boot-krasch). Kräver backend
  igång + `E2E_PASSWORD`. Engångsuppsättning: `npx playwright install chromium`. Se `frontend/e2e/README.md`.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) kör backend + frontend automatiskt vid varje
  push/PR. E2E ingår inte i CI än (kräver körande app + secret för lösenordet).

## 5. Next Steps / Ongoing Tasks

- **F2 — stäng loopen:** utgående e-post (egen domän, SPF/DKIM/DMARC), SMS via 46elks, kalender/bokning kopplad till röst-AI. Gör SCC oberoende av GHL i egen drift.
- **Säkerhet före extern kunddata (före F4):** aktivera RLS + policies på kärntabellerna, fixa frontend-token-läckan (`VITE_*_TOKEN` i bundlen), riktig användarauth.
- **Cal.com-env:** sätt `CALCOM_API_KEY` + `CALCOM_EVENT_TYPE_ID` i `backend/.env` så `book_appointment` fungerar.
- **Complete ElevenLabs Voice Setup:** Finalize webhook configuration in ElevenLabs dashboard.
- **AI Influencer Project:** Continue development of content strategy, auto-posting workflows, and visual assets.

--- 

**Ursprunglig setup-dok av Alex 2026-02-13 · uppdaterad 2026-07-12 (F1 CRM) · 2026-07-21 (tester + CI)**