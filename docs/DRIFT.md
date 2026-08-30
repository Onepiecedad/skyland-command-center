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
| Skills | `~/.openclaw/skills`, kärnan `scc-crm` (discover, prospect, dm, bump, ads). Nycklar via `scripts/env.py` (se Konfiguration). Research-steget gör en omkörning med skärpt brief vid format/timeout (plan 2.2, 30 aug); `custom.research_attempts` på kortet visar hur många försök det tog. | Joakims Mac | fungerar; bortfallet ska mätas efter nästa batch (var ~50 % före 2.2) |
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

## Konfiguration (fynd 3, åtgärdat 30 aug)

**Prod = Render.** Inget annat. `scripts/drift_check.py` jämför prod mot den här filen.

**Macen (Alex/skills):** en laddare, `~/.openclaw/skills/scc-crm/scripts/env.py`. Prioritet: process-miljö → `~/.openclaw/.env` (**kanon för hemligheter på Macen**) → `openclaw.json → env.vars` (det gatewayn injicerar i Alex) → `~/Developer/openclaw-config/.env` (bakåtkompat). Alla pipelines, `scc.sh`, `dm_pipeline.sh` och `scc_poller.py` går via den. Kontroll: `python3 ~/.openclaw/skills/scc-crm/scripts/env.py --check` visar var varje nyckel hittas (maskat) och flaggar konflikter, exit 1 vid konflikt. **Vid nyckelrotation: uppdatera `~/.openclaw/.env`, `openclaw.json → env.vars` och `~/Developer/openclaw-config/.env`, kör `--check`, starta om gateway + poller** (`launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway` och `.../com.skyland.scc-poller`). 30 aug hittade `--check` att `openclaw.json` låg kvar på den gamla SCC-nyckeln efter rotationen; pollern var utelåst tills den rättades.

**`backend/.env` på Macen** är bara för lokal utveckling. Den har en varningsrubrik och `OUTBOUND_ENABLED=false`, `OUTBOUND_MODE=shadow`, `SEQUENCE_RUNNER_ENABLED=false`, `TRANSACTIONAL_OUTBOUND_ENABLED=false` låsta, så en lokal backend mot prod-databasen aldrig kan skicka. n8n-nycklarna borttagna.

**Skill-kopior:** live är `~/.openclaw/skills/scc-crm/` (där allt arbete sker). Repo-kopian `~/Developer/openclaw-config/skills/scc-crm/` låg flera veckor efter och `sync_skills.sh` (repo → live, `rsync --delete`) hade raderat reaktiveringsdoktrinen. Synkad ikapp 30 aug (commit `579ec41` i openclaw-config). Regel: **ändra i live, kopiera live → repo, committa. Kör aldrig `sync_skills.sh` utan att först diffa** (`diff -rq` mellan de två).

## Pågående i produktion

- Bokningsflödet verifierat live 30 aug kväll: Cal.com-testbokning → bekräftelsemejl skickat skarpt (policy transactional, trots OUTBOUND_ENABLED=false/shadow) → avbokning → påminnelsekörningen avslutad med exit_reason=booking_cancelled. Sajtens boka-knapp pekar på Cal.com (Calendly raderat 30 aug).
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
- **Hemsidans boka-knapp länkar till Calendly** (`calendly.com/joakim-skylandai/30min`), inte Cal.com. Calendly-bokningar når aldrig SCC (ingen webhook, inga påminnelser, inget kort) och Calendly var 30 aug trasigt ("calendar unavailable", Google Calendar-kopplingen). Endast röstagenten bokar via Cal.com. **Åtgärd:** peka knappen på `https://cal.com/joakim-landqvist-yrcioq/15min` i repot Skyland_AI_System, eller lägg ned Calendly.
