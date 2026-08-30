# DRIFT.md — vad som kör just nu

> **Den enda sanningen om driften.** Uppdateras i samma commit som ändrar något.
> Handover-filerna under `docs/HANDOVER_*.md` är historik, inte nuläge.
> Senast verifierad: **2026-08-30 kväll** (Claude + Joakim, live-tester mot prod).
> Maskinell koll: `SCC_API_TOKEN=… python3 scripts/drift_check.py` jämför prod (`/health`,
> `/api/v1/integrations/health`, `/api/v1/integrations/flags`) mot tabellen nedan. Exit 1 = drift.

## Tjänster

| Lager | Vad | Var | Status |
|---|---|---|---|
| SCC backend + frontend | Express + Supabase + React-SPA i en container. CRM, sekvensmotor, inbound-mejl, sajt-webhookar, röst-proxy, bokningar, integrationshälsa. | Render, arbetsyta **"Joakim's workspace"**, tjänst `scc`, Starter, autodeploy från `main`, `scc.skylandai.se` (CNAME → scc-e8x1.onrender.com) | uppe |
| Supabase | Postgres, projekt `skyland-command-center` (`wfwqjxsuvbacvcmpiesl`), eu-north-1. SCC-tabeller **och** sajtens tabeller (`sessions`, `events`, `prospects`, `interactions`, `voice_calls`, `knowledge_base`) i samma projekt. | supabase.com | uppe |
| Hemsidan skylandai.se | Netlify-projekt **`skyland-ai-os`** (repo `Onepiecedad/Skyland_AI_System`, lokal kopia `~/Downloads/stitch_skyland_ai_operating_system`, publish dir `app/`). Domänen flyttad hit 2026-08-30 från det gamla statiska projektet `skylandai`. | Netlify (konto joakim123@gmail.com), DNS på One.com (apex A 75.2.60.5, www CNAME → skyland-ai-os.netlify.app). **Apex-raden på One.com har TOMT hostname-fält — skriv aldrig något i det.** | uppe |
| Sajtens backend | Allt som förr gick via n8n går nu till SCC: `/api/v1/webhooks/site/*`. Se `docs/SITE_FLOWS.md`. | SCC | uppe, testat |
| Röst på sajten | ElevenLabs Conversational AI, **två agenter i SCC:s ElevenLabs-konto**: `Alex (skylandai.se)` sv `agent_8301m19fffmqfcv96zgryg5ey3k5`, `Alex (skylandai.se, EN)` en `agent_4501m19h1g8zfq7v6k6hqh642p32`. Signerad URL + call-ended via SCC. Verktyg mot SCC `/site/agent-tools/*`. Återskapas med `backend/scripts/create_site_agent.py`. | ElevenLabs (nyckel = `ELEVENLABS_API_KEY` i Render) | uppe |
| Mejl ut | Resend, `Skyland AI <joakim@send.skylandai.se>`, DKIM/SPF/DMARC på send.skylandai.se. | Resend (joakim123), eu-west-1 | uppe |
| Mejl in | Resend Inbound (MX på One.com) → `POST /api/v1/webhooks/email/inbound?token=EMAIL_INBOUND_TOKEN`. received → inbox + sekvensstopp + kopia till `EMAIL_FORWARD_TO`; bounced/complained → suppression. | Resend-webhook | uppe, testat 30 aug |
| Bokningar | Cal.com äger bokningen (event type 15 min, `CALCOM_EVENT_TYPE_ID`). Webhook → `/api/v1/webhooks/calcom?token=` → speglas i `bookings`. Kalenderfliken visar dem med detaljkort. | Cal.com + SCC | uppe |
| MarinMekaniker ordernotis | marinmekaniker.nu (Netlify `marin-mekaniker`) → `POST /api/v1/webhooks/marinmekaniker/order?token=` → två mejl via Resend. | SCC | uppe, testat |
| Alex / OpenClaw | Gateway på Joakims Mac (launchd, port 18789), poller `~/Developer/openclaw-config/scripts/scc_poller.py`. Kimi K2.5 orkestrerare, DeepSeek V4 Flash underagenter. **WhatsApp** som kanal. | Joakims Mac | beror på att datorn är igång |
| Skills | `~/.openclaw/skills`, kärnan `scc-crm` (discover, prospect, dm, bump, ads). | Joakims Mac | fungerar, research ~50 % bortfall |
| Apify | Google Maps (discover), Meta Ad Library (ads), Instagram (target). | Betald plan sedan 28 aug | uppe |

## Avvecklat (peka inte på dessa)

| Vad | Status | Kvar för Joakim |
|---|---|---|
| n8n Cloud `onepiecedad.app.n8n.cloud` | Uppsagt 30 aug. Alla 9 workflows portade till SCC 2026-08-30 (export i `docs/n8n-archive/`). DNS `n8n.skylandai.se` borttagen. | Inget. |
| Fly-appen `skyland-voice-proxy` | Låg under ett Fly-konto Joakim inte når. Ersatt av `/api/v1/webhooks/site/voice/*`. | Inget. |
| ElevenLabs-agenterna `agent_8701…` (sv) och `TDgRNcUoUC1GHVKK0bHH` (en) | Låg i ett annat ElevenLabs-konto. Återskapade i SCC:s konto. | Kontot kan avslutas om inget annat ligger där. |
| Netlify-projekt `skylandai` | Raderat 30 aug. `www.skylandai.se` CNAME pekar nu på `skyland-ai-os.netlify.app`. | Inget. |
| Render-tjänst `scc-backend` ("My Workspace", Free) | Raderad 30 aug. | Inget. |

## Produktionsflaggor (Render → scc → Environment)

| Flagga | Värde | Effekt |
|---|---|---|
| `OUTBOUND_ENABLED` | `false` | Motorn skickar inget på egen hand. Gäller sekvenser med `outbound_policy='outreach'` (default). |
| `TRANSACTIONAL_OUTBOUND_ENABLED` | ej satt (default `true`) | Kill switch för `outbound_policy='transactional'` (Strategisamtal-påminnelserna). Transaktionell post går ut OAVSETT `OUTBOUND_ENABLED`/`OUTBOUND_MODE`/dagsbudget; suppression gäller utom orsaken `existing_customer`. Fynd 4 åtgärdat 30 aug. |
| `OUTBOUND_MODE` | `shadow` | Utskick loggas som `messages.status='shadow'`. Granskas i Försäljning → Skuggvecka; "Skicka nu" skickar manuellt. |
| `SEQUENCE_RUNNER_ENABLED` | `true` | Motorn tickar varje minut. **Verifiera dessa tre innan du enrollar något med `next_run_at=now()`.** |
| `OUTBOUND_DAILY_LIMIT` | `5` | Tak för riktiga utskick/dag, gäller även "Skicka nu". |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` / `EMAIL_FORWARD_TO` | `Skyland AI <joakim@send.skylandai.se>` / `joakim@send.skylandai.se` / `joakim@skylandai.se` | Avsändare, svar till Inbound, kopia till inkorgen. |
| `EMAIL_INBOUND_TOKEN` | satt | Token i Resend-webhookens URL. |
| `RESEND_API_KEY` | satt | Mejl ut + integrationshälsan. |
| `LEADS_INTAKE_TOKEN` | satt | Används av: `/leads/intake`, MarinMekaniker-webhooken (Netlify-env), sajtens `agent-tools` och `rag-query` (X-Skyland-Key), `voice-call-ended` (server-till-server). |
| `OPENAI_API_KEY` | satt | Embeddings (text-embedding-3-small) + gpt-4o-mini för void-svar och samtalsextraktion. |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | satt | Nyckeln äger sajtens två agenter. `ELEVENLABS_AGENT_ID` = mäklaragenten (`/api/v1/voice/*`), inte sajtens. |
| `CALCOM_API_KEY` / `CALCOM_EVENT_TYPE_ID` / `CALCOM_WEBHOOK_TOKEN` | satt | Lediga tider, bokning, spegling. |
| `INTEGRATION_HEALTH_ENABLED` | `true` | Vakten probar alla integrationer var 10:e minut och loggar `integration.health.degraded` i activities när något är nere. Satt 30 aug. |
| Valfria, ej satta | `SITE_VOICE_WEBHOOK_TOKEN`, `SITE_RAG_KEY`, `SITE_ELEVENLABS_API_KEY`, `EXTRA_CORS_ORIGINS`, `MM_ORDER_WEBHOOK_TOKEN` | Faller tillbaka på `LEADS_INTAKE_TOKEN` resp. `ELEVENLABS_API_KEY`. |

## Konfiguration (känd svaghet, fynd 3)

Hemligheter finns i fem källor: Render env, `backend/.env` (Mac, **ej synkad med prod**), `~/.openclaw/.env`, `~/Developer/openclaw-config/.env`, `openclaw.json → env.vars`. Skillarna läser från tre olika. Lita bara på Render för prod. Åtgärd planerad i stabiliseringsplanen fas 1.

## Pågående i produktion

- Sekvens **"MEXPAND — Strategisamtal påminnelser"** har `outbound_policy='transactional'` (migration `20260830_outbound_policy.sql`, applicerad). Övriga tre sekvenser är `outreach`. Nästa steg för den enda aktiva enrollmenten (Joakims testbokning 31/8 09:00) är ett SMS 08:00 — kontakten saknar telefon → synlig skip, inget skickas.
- Sekvens **"Reaktivering — beauty"** aktiv med 7 enrollments (beauty-kliniker Göteborg), nästa steg **2026-09-01 17:03** i skuggläge. Döm i Skuggvecka. Autosend-beslut 7 sep.
- Suppression-listan seedad med befintliga kunder (GKMK, Vinnie) + studsar.

## Kända skavanker

- `backend/src/routes/skills.test.ts`: två tester röda på main (slår mot riktig DB). Inte relaterat till sajt/reaktivering.
- Frontendens `*.test.tsx` saknar jest-dom-typer (tsc rött bara i testfiler; `vite build` grönt).
- Commit `b1cda98` fick med tre lokala ändringar som låg okommittade (`backend/src/index.ts` legacy, `docs/HANDOVER_2026-07-27.md`, `docs/IG_DM_AUTOMATION.md`).
- Integrationshälsan: `n8n:*`-checkarna är borta (2.1b, 30 aug). Nya: `site:skylandai.se`, `site:lang.js` (båda agent-id:na), `site:agent-tools` (självtest över publika adressen med X-Skyland-Key), `elevenlabs:site-agents`. Agent-id:n är hårdkodade i `services/integrationHealth.ts` — byter du agent, byt där + `lang.js` + SITE_FLOWS.
- `GET /api/v1/website/workflows` (Sajt-fliken, "n8n Workflow-hälsa") pekar fortfarande på n8n:s API. Död — visar tomt. Riv eller byt mot `activities` från sajt-webhookarna.
- Engelska röstagenten är otestad i skarpt samtal.
