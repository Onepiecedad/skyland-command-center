# DRIFT.md — vad som kör just nu

> **Den enda sanningen om driften.** Uppdateras i samma commit som ändrar något.
> Handover-filerna under `docs/HANDOVER_*.md` är historik, inte nuläge.
> Senast verifierad: **2026-09-08** (Claude + Joakim: Cold Experience-mejlsekvensen, dagsbudget per avsändardomän).
> Maskinell koll: `SCC_API_TOKEN=… python3 scripts/drift_check.py` jämför prod (`/health`,
> `/api/v1/integrations/health`, `/api/v1/integrations/flags`) mot tabellen nedan. Exit 1 = drift.

## Tjänster

| Lager | Vad | Var | Status |
|---|---|---|---|
| SCC backend + frontend | Express + Supabase + React-SPA i en container. CRM, sekvensmotor, inbound-mejl, sajt-webhookar, röst-proxy, bokningar, integrationshälsa. | Render, arbetsyta **"Joakim's workspace"**, tjänst `scc`, Starter, autodeploy från `main`, `scc.skylandai.se` (CNAME → scc-e8x1.onrender.com) | uppe |
| Supabase | Postgres, projekt `skyland-command-center` (`wfwqjxsuvbacvcmpiesl`), eu-north-1. SCC-tabeller **och** webbspårningens tabeller (`sessions`, `events`, `prospects`, `interactions`, `voice_calls`, `knowledge_base`) i samma projekt. `sessions`/`events` bär `tenant_id` sedan 7 sep och rymmer flera kunders sajter — se `docs/SITE_FLOWS.md`. | supabase.com | uppe |
| Hemsidan skylandai.se | Netlify-projekt **`skyland-ai-os`** (repo `Onepiecedad/Skyland_AI_System`, lokal kopia `~/Downloads/stitch_skyland_ai_operating_system`, publish dir `app/`). Domänen flyttad hit 2026-08-30 från det gamla statiska projektet `skylandai`. | Netlify (konto joakim123@gmail.com), DNS på One.com (apex A 75.2.60.5, www CNAME → skyland-ai-os.netlify.app). **Apex-raden på One.com har TOMT hostname-fält — skriv aldrig något i det.** | uppe |
| Sajtens backend | Allt som förr gick via n8n går nu till SCC: `/api/v1/webhooks/site/*`. Se `docs/SITE_FLOWS.md`. | SCC | uppe, testat |
| Röst på sajten | ElevenLabs Conversational AI, **två agenter i SCC:s ElevenLabs-konto**: `Alex (skylandai.se)` sv `agent_8301m19fffmqfcv96zgryg5ey3k5`, `Alex (skylandai.se, EN)` en `agent_4501m19h1g8zfq7v6k6hqh642p32`. Signerad URL + call-ended via SCC. Verktyg mot SCC `/site/agent-tools/*`. Återskapas med `backend/scripts/create_site_agent.py`. | ElevenLabs (nyckel = `ELEVENLABS_API_KEY` i Render) | uppe |
| Röst på WhatsApp (walkie-talkie) | Röstmeddelande till Alex → transkribering via `POST /api/v1/voice/stt` (ElevenLabs Scribe) → svar som röstmeddelande med sajtens svenska Alex-röst via `POST /api/v1/voice/alex-tts`. Båda Bearer `SCC_API_TOKEN`, definierade före voice-routerns `VOICE_WEBHOOK_TOKEN`-krav. Skillen `walkie-talkie-mode` på VPS anropar dem; ElevenLabs-nyckeln lämnar aldrig Render. Kräver ffmpeg på VPS för ogg/opus-röstbubblor (annars mp3). | SCC + VPS | byggd 1 sep, verifieras efter deploy |
| Mejl ut | Resend, `Skyland AI <joakim@send.skylandai.se>`, DKIM/SPF/DMARC på send.skylandai.se. | Resend (joakim123), eu-west-1 | uppe |
| Mejl in | Resend Inbound (MX på One.com) → `POST /api/v1/webhooks/email/inbound?token=EMAIL_INBOUND_TOKEN`. received → inbox + sekvensstopp + kopia till `EMAIL_FORWARD_TO`; bounced/complained → suppression. **Sedan 31 aug klassas varje matchat svar** (plan 3.1): regler fångar autosvar utan LLM-anrop, resten går till orkestrerarmodellen, och över `REPLY_CLASSIFIER_MIN_CONFIDENCE` flyttas kortet (intresse/fråga → Replied, nej → No Fit) och ett nej spärrar adressen. Klassificeringen är best-effort och kan aldrig fälla inmatningen. | Resend-webhook | uppe, testat 30 aug |
| Bokningar | Cal.com äger bokningen (event type 15 min, `CALCOM_EVENT_TYPE_ID`). Webhook → `/api/v1/webhooks/calcom?token=` → speglas i `bookings`. Kalenderfliken visar dem med detaljkort. | Cal.com + SCC | uppe |
| MarinMekaniker ordernotis | marinmekaniker.nu (Netlify `marin-mekaniker`) → `POST /api/v1/webhooks/marinmekaniker/order?token=` → två mejl via Resend. | SCC | uppe, testat |
| Webbspårning marinmekaniker.nu | Tracker `frontend/src/utils/spar.js` → `/api/v1/webhooks/site/{session-init,track-event}` med sajtnyckel. Syns i Thomas kundkort, fliken Hemsida. Autodeploy från `main` fungerar. | SCC + Netlify `marin-mekaniker` | uppe, verifierat 7 sep |
| Webbspårning coldexperience.se | Samma tracker i `Onepiecedad/ColdExperience` (`Projekt/ColdExperience-4`). Syns i Gustavs kundkort. **Sajten bygger inte om vid push** — se skavanker. | SCC + Netlify `coldexperience` | uppe, verifierat 7 sep |
| Alex / OpenClaw | **Gateway på VPS sedan 31 aug** (Hetzner CPX22, Helsingfors, 62.238.113.151, användare `alex`, systemd user-units med linger). Poller `~/openclaw-config/scripts/scc_poller.py`. Gatewayn nås över Tailscale på `https://alex.tail8a8e79.ts.net` (tailnet-only, loopback-bunden, inga öppna portar) — Kontoret i SCC pratar med den därifrån. Macens launchd-jobb ligger som `.plist.disabled` — starta dem aldrig igen, två pollers gör dubbelt arbete. Kimi K2.5 orkestrerare (fallback gemini-2.5-flash; claude-sonnet-4-20250514 rensad 31 aug, leverantören avvisar den). Researchern kör Kimi K2.5 sedan 30 aug (fallback DeepSeek V4 Flash) — se 2.3-jämförelsen i HANDOVER_2026-08-30: 10/10 mot 5/10 godkända på första försöket. Övriga underagenter DeepSeek V4 Flash. **WhatsApp** som kanal. | Hetzner CPX22 hel1 | uppe dygnet runt |
| Skills | `~/.openclaw/skills`, kärnan `scc-crm` (discover, prospect, dm, bump, ads). Nycklar via `scripts/env.py` (se Konfiguration). Research-steget gör en omkörning med skärpt brief vid format/timeout (plan 2.2, 30 aug); `custom.research_attempts` på kortet visar hur många försök det tog. | Joakims Mac | fungerar; bortfallet ska mätas efter nästa batch (var ~50 % före 2.2) |
| Dualhook | **Meta Tech Partner som kopplar in Cold Experiences WhatsApp-nummer.** Vald 8 sep i stället för egen App Review. **Numret inkopplat 8 sep 23:15 via coexistence (QR i Business-appen).** Nummer +46 73 550 71 23, WABA `1021280300798738`, Phone Number ID `1289813200882119`, Business ID `698578172315817`. Inkommande går via Webhook Override från Meta rakt till `ce-agent-webhook`; handskakningen verifierad `GET 200` 23:18:01. Utgående via `api.dualhook.com` med `dh_live_`-nyckel — **inte skapad än, vi kan ta emot men inte svara.** Developer 12 €/mån. **Provperioden slutar 22 sep.** Heartbeat: appen måste öppnas var 13:e dag, nästa förfall 21 sep. | dualhook.com |
| Apify | Google Maps (discover), Meta Ad Library (ads), Instagram (target). | Betald plan sedan 28 aug | uppe |

## Avvecklat (peka inte på dessa)

| Vad | Status | Kvar för Joakim |
|---|---|---|
| n8n Cloud `onepiecedad.app.n8n.cloud` | Uppsagt 30 aug. Alla 9 workflows portade till SCC 2026-08-30 (export i `docs/n8n-archive/`). DNS `n8n.skylandai.se` borttagen. | Inget. |
| Fly-appen `skyland-voice-proxy` | Låg under ett Fly-konto Joakim inte når. Ersatt av `/api/v1/webhooks/site/voice/*`. | Inget. |
| ElevenLabs-agenterna `agent_8701…` (sv) och `TDgRNcUoUC1GHVKK0bHH` (en) | Låg i ett annat ElevenLabs-konto. Återskapade i SCC:s konto. | Kontot kan avslutas om inget annat ligger där. |
| Netlify-projekt `skylandai` | Raderat 30 aug. `www.skylandai.se` CNAME pekar nu på `skyland-ai-os.netlify.app`. | Inget. |
| Render-tjänst `scc-backend` ("My Workspace", Free) | Raderad 30 aug. | Inget. |
| **Netlify-projektet `skyland-scc`** | **Aldrig i drift, men finns kvar och är en fälla.** `scc.skylandai.se` är CNAME till `scc-e8x1.onrender.com`, alltså Render, som bygger backend och frontend i samma Docker-image och autodeployar från `main`. Netlify-siten är en parallell kopia som ingen tittar på: `skyland-scc.netlify.app` serverar sin egen bundle och påverkar ingenting. **Deploya aldrig SCC till Netlify.** Jag gjorde det 9 sep innan jag kollat DNS, och den deployen nådde förstås ingen. | Radera projektet i Netlify, eller döp om det till `AVSTALLD-skyland-scc`. Joakims klick. |

## Produktionsflaggor (Render → scc → Environment)

| Flagga | Värde | Effekt |
|---|---|---|
| `OUTBOUND_ENABLED` | `true` (5 sep) | Motorn skickar på egen hand. Gäller sekvenser med `outbound_policy='outreach'` (default). |
| `OUTREACH_JITTER_MINUTES` | ej satt (default `90`) | Slumpad spridning av LIVE outreach, 1–N minuter, så en batch inte fyrar i samma tick. |
| `OUTREACH_WINDOW_ENABLED` | ej satt (default `true`) | Plan 2.5: LIVE outreach skickas bara vardagar 08–17 (Europe/Stockholm, `OUTREACH_WINDOW_START_HOUR`/`END_HOUR`) och sprids slumpat 1–90 min (`OUTREACH_JITTER_MINUTES`) så en batch inte fyrar i samma tick. Gäller INTE transactional och INTE skuggläget (skuggrader ska synas direkt i Skuggvecka). |
| `TRANSACTIONAL_OUTBOUND_ENABLED` | ej satt (default `true`) | Kill switch för `outbound_policy='transactional'` (Strategisamtal-påminnelserna). Transaktionell post går ut OAVSETT `OUTBOUND_ENABLED`/`OUTBOUND_MODE`/dagsbudget; suppression gäller utom orsaken `existing_customer`. Fynd 4 åtgärdat 30 aug. |
| `OUTBOUND_MODE` | `auto` (5 sep) | Steg med `require_approval: true` går ändå i skugga. Utskick i skugga loggas som `messages.status='shadow'`. Granskas i Försäljning → Skuggvecka; "Skicka nu" skickar manuellt. |
| `SEQUENCE_RUNNER_ENABLED` | `true` | Motorn tickar varje minut. **Verifiera dessa tre innan du enrollar något med `next_run_at=now()`.** |
| `OUTBOUND_DAILY_LIMIT` | `20` (höjt 5 sep från 5) | Tak per **hink** och dygn, gäller även "Skicka nu". Nattjobbet skriver in högst 12 öppnare/dygn; resten av taket är utrymme för bump och avslut. Vid 12 utskick/dag når du 50 skickade öppnare på fyra dagar — det är först då copyn går att bedöma. |
| `OUTBOUND_DAILY_LIMITS` | `{"email:coldexperience.se":5}` (satt 8 sep kväll) | JSON med eget tak per hink. Saknas en nyckel gäller `OUTBOUND_DAILY_LIMIT` (20) för den hinken. Cold Experience-domänen har ingen uppvärmningshistorik hos Resend; höj enligt trappan i `EMAIL_INFRA.md`, aldrig i förväg. Trasig JSON gör att backenden vägrar starta, med flit. Exponeras i `/integrations/flags` sedan 8 sep kväll — dessförinnan lästes den men syntes inte, så `drift_check` kunde inte kontrollera den. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` / `EMAIL_FORWARD_TO` | `Skyland AI <joakim@send.skylandai.se>` / `joakim@send.skylandai.se` / `joakim@skylandai.se` | Avsändare, svar till Inbound, kopia till inkorgen. |
| `EMAIL_INBOUND_TOKEN` | satt | Token i Resend-webhookens URL. |
| `RESEND_API_KEY` | satt | Mejl ut + integrationshälsan. |
| `LEADS_INTAKE_TOKEN` | satt | Används av: `/leads/intake`, MarinMekaniker-webhooken (Netlify-env), sajtens `agent-tools` och `rag-query` (X-Skyland-Key), `voice-call-ended` (server-till-server). |
| `OPENAI_API_KEY` | satt | Embeddings (text-embedding-3-small) + gpt-4o-mini för void-svar och samtalsextraktion. |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | satt | Nyckeln äger sajtens två agenter. `ELEVENLABS_AGENT_ID` = mäklaragenten (`/api/v1/voice/*`), inte sajtens. |
| `CALCOM_API_KEY` / `CALCOM_EVENT_TYPE_ID` / `CALCOM_WEBHOOK_TOKEN` | satt | Lediga tider, bokning, spegling. |
| `INTEGRATION_HEALTH_ENABLED` | `true` | Vakten probar alla integrationer var 10:e minut och loggar `integration.health.degraded` i activities när något är nere. Satt 30 aug. |
| `POLLER_WATCHDOG_ENABLED` | ej satt (default `true`) | Larmar via Resend när Alex poller inte hämtat från `/claw/pending` på `POLLER_STALE_MINUTES`. Ett mejl när hjärtslaget dör, ett när det kommer tillbaka — aldrig en påminnelse i minuten. Byggd 31 aug (plan 3.3). |
| `POLLER_STALE_MINUTES` | ej satt (default `15`) | Hur länge pollern får vara tyst innan det räknas som fel. |
| `POLLER_WATCHDOG_INTERVAL_MS` | ej satt (default `60000`) | Hur ofta vakten kontrollerar. |
| `REPLY_CLASSIFIER_ENABLED` | ej satt (default `true`) | Klassar inkommande svar och agerar på dem. `false` stänger av allt: inget anrop, ingen flytt, ingen spärr — inmatningen fortsätter som förr. Byggd 31 aug (plan 3.1). |
| `REPLY_CLASSIFIER_MIN_CONFIDENCE` | ej satt (default `0.8`) | Under tröskeln loggas klassen men kortet står kvar och ingen spärras. Ett felklassat nej spärrar en kund som ville köpa — det felet får inte gå automatiskt. |
| `DAILY_DIGEST_ENABLED` | ej satt (default `true`) | Ett digestmejl till `EMAIL_FORWARD_TO` varje morgon med dygnets siffror. Byggd 31 aug (plan 3.2). |
| `DAILY_DIGEST_HOUR` | ej satt (default `7`) | Timme i **svensk** tid. Containern kör UTC; digesten räknar om själv. |
| `DAILY_DIGEST_INTERVAL_MS` | ej satt (default `900000`) | Hur ofta klockan kollas. Digesten går första kontrollen efter timslaget. |
| `WHATSAPP_VERIFY_TOKEN` | **ej satt, avsiktligt** | Hör till SCC-routen `/api/v1/webhooks/whatsapp`, som är **ej i drift** sedan beslutet 8 sep (Cold Experience går Dualhook → `ce-agent-webhook` i Supabase). De fyra `WHATSAPP_*`-variablerna nedan ska förbli tomma tills en andra WhatsApp-kund eventuellt använder SCC-routen. |
| `WHATSAPP_APP_SECRET` | **ej satt** | Appens hemlighet (Meta App Dashboard → App settings → Basic). Med den satt signaturkontrolleras varje POST (`X-Hub-Signature-256`). **Utan den accepteras bara Bearer `LEADS_INTAKE_TOKEN`** — test/manuell väg, inte produktion. |
| `WHATSAPP_ACCESS_TOKEN` | **ej satt** | Svarsvägen ut via Graph API. Permanent system-user-token från Business Manager, inte det 24-timmars-token Meta visar i dashboarden. |
| `WHATSAPP_PHONE_NUMBER_ID` | **ej satt, avsiktligt** | Skulle vara Cold Experience-numret för SCC-routen. Sätts INTE: numret kopplas via Dualhook till Supabase-funktionen (beslut 8 sep). |
| `WHATSAPP_TENANT_SLUG` | ej satt (default `cold-experience`) | Vart inkommande hamnar när `phone_number_id` inte matchar någon `tenants.config.whatsapp_phone_number_id`. |
| `WHATSAPP_OUTBOUND_ENABLED` | ej satt (default `true`) | Egen kill switch för WhatsApp-svar. Ett svar till någon som själv skrivit in är inte outreach och lyder därför **inte** `OUTBOUND_ENABLED`/`OUTBOUND_MODE`/dagsbudgeten. |
| `WHATSAPP_GRAPH_VERSION` | ej satt (default `v21.0`) | Graph API-version. |
| Valfria, ej satta | `SITE_VOICE_WEBHOOK_TOKEN`, `SITE_RAG_KEY`, `SITE_ELEVENLABS_API_KEY`, `EXTRA_CORS_ORIGINS`, `MM_ORDER_WEBHOOK_TOKEN` | Faller tillbaka på `LEADS_INTAKE_TOKEN` resp. `ELEVENLABS_API_KEY`. |

## Konfiguration (fynd 3, åtgärdat 30 aug)

**Prod = Render.** Inget annat. `scripts/drift_check.py` jämför prod mot den här filen.

**Hemligheter på VPS:en:** `~/.openclaw/.env` är kanon och innehåller sedan 8 sep kväll även de nycklar som tidigare bara låg inbakade i `openclaw.json` (Google, Brave, OpenAI, SAG, gateway- och hooks-token) samt `OPENCLAW_HOME=/home/alex`. `~/openclaw-config/.env` finns kvar som reserv för `env.py`, men deploy-skriptet läser kanon först (var omvänt till 8 sep, och den gamla repo-filen vann tyst). Backup `~/.openclaw/.env.bak-8sep`.

**Macen (Alex/skills):** en laddare, `~/.openclaw/skills/scc-crm/scripts/env.py`. Prioritet: process-miljö → `~/.openclaw/.env` (**kanon för hemligheter på Macen**) → `openclaw.json → env.vars` (det gatewayn injicerar i Alex) → `~/Developer/openclaw-config/.env` (bakåtkompat). Alla pipelines, `scc.sh`, `dm_pipeline.sh` och `scc_poller.py` går via den. Kontroll: `python3 ~/.openclaw/skills/scc-crm/scripts/env.py --check` visar var varje nyckel hittas (maskat) och flaggar konflikter, exit 1 vid konflikt. **Vid nyckelrotation: uppdatera `~/.openclaw/.env`, `openclaw.json → env.vars` och `~/Developer/openclaw-config/.env`, kör `--check`, starta om gateway + poller** (`launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway` och `.../com.skyland.scc-poller`). 30 aug hittade `--check` att `openclaw.json` låg kvar på den gamla SCC-nyckeln efter rotationen; pollern var utelåst tills den rättades.

**`backend/.env` på Macen** är bara för lokal utveckling. Den har en varningsrubrik och `OUTBOUND_ENABLED=false`, `OUTBOUND_MODE=shadow`, `SEQUENCE_RUNNER_ENABLED=false`, `TRANSACTIONAL_OUTBOUND_ENABLED=false` låsta, så en lokal backend mot prod-databasen aldrig kan skicka. n8n-nycklarna borttagna.

**Skill-kopior:** live är `~/.openclaw/skills/scc-crm/` (där allt arbete sker). **Status 8 sep: tretton filer skiljer sig mellan live och repo**, bland annat `SKILL.md` och sex pipeline-skript, och ingen vet vilken sida som är nyast. Cold Experience-materialet (nio filer, bland annat `crm-spegling.md`) kopierades live → repo 8 sep eftersom det saknades helt. Res ut resten för hand innan någon kör `sync_skills.sh`. Repo-kopian `~/Developer/openclaw-config/skills/scc-crm/` låg flera veckor efter och `sync_skills.sh` (repo → live, `rsync --delete`) hade raderat reaktiveringsdoktrinen. Synkad ikapp 30 aug (commit `579ec41` i openclaw-config). Regel: **ändra i live, kopiera live → repo, committa. Kör aldrig `sync_skills.sh` utan att först diffa** (`diff -rq` mellan de två).

## Pågående i produktion

- Bokningsflödet verifierat live 30 aug kväll: Cal.com-testbokning → bekräftelsemejl skickat skarpt (policy transactional, trots OUTBOUND_ENABLED=false/shadow) → avbokning → påminnelsekörningen avslutad med exit_reason=booking_cancelled. Sajtens boka-knapp pekar på Cal.com (Calendly raderat 30 aug).
- Sekvens **"MEXPAND — Strategisamtal påminnelser"** har `outbound_policy='transactional'` (migration `20260830_outbound_policy.sql`, applicerad). Övriga tre sekvenser är `outreach`. Nästa steg för den enda aktiva enrollmenten (Joakims testbokning 31/8 09:00) är ett SMS 08:00 — kontakten saknar telefon → synlig skip, inget skickas.
- Sekvens **"Reaktivering — beauty"** aktiv med 7 enrollments (beauty-kliniker Göteborg), nästa steg **2026-09-01 17:03** i skuggläge. Döm i Skuggvecka. Autosend-beslut 7 sep.
- Suppression-listan seedad med befintliga kunder (GKMK, Vinnie) + studsar.

## Schemalagda jobb på Alex (fixat 1 sep)

Cron ligger **inte** i `openclaw-config/cron/jobs.json` längre — OpenClaw flyttade
det till `~/.openclaw/state/openclaw.sqlite` (tabellen `cron_jobs`). Repo-filen är
arkiverad; `cron/README.md` visar hur man läser den riktiga tabellen.

**Roten till att inget kört sedan flytten:** varje rad i `cron_jobs` hade
`store_key = /Users/onepiecedad/.openclaw/cron/jobs.json`, alltså Macens sökväg.
Schemaläggaren på VPS:en läser `/home/alex/.openclaw/cron/jobs.json`, hittade noll
jobb och fyrade ingenting. Det förklarade också varför ett jobb som lades till
*efter* flytten körde felfritt var femte minut: det skrevs under rätt nyckel.
Nio rader flyttade till rätt nyckel 1 sep (databasen säkerhetskopierad först till
`openclaw.sqlite.bak-*`), `next_run_at_ms` nollställd så schemat räknas om, gateway
omstartad. **Kolla `store_key` först om jobb slutar fyra efter en flytt.**

| Jobb | Schema | Läge |
|---|---|---|
| **Skyland morgon** | 07:00 | ok, levererad. SCC-siffrorna, vädret, maskinens hälsa, nattens påfyllnadsrapport, och alltid en rad även när allt är lugnt. **Läste fel fil till 5 sep:** `brief-DATUM.md` från det avstängda jobbet *Skyland nattliga leads*. Den hade rapporterat "nattkörningen fallerade" varje morgon. Pekar nu på `fill-DATUM.md` |
| Kvällssammanfattning | 21:00 | ok, levererad. Läser SCC:s `/reports/digest` |
| **Skyland nattlig påfyllnad** | 02:00 | **NY 5 sep.** `payload_kind=command` → `daily_fill.py`. Ingen leverans (utskriften är hundratals rader), larm efter första felet. Se *Nattlig påfyllnad* nedan |
| Preflight | 06:30 | ok. Larm efter ETT fel |
| **Kundvakt — veckorapport** | fre 15:00 | **fel 5 sep:** "Agent couldn't generate a response". Hade inget larm; det är satt nu |
| ~~Skyland nattliga leads~~ | 02:00 | **avstängd 5 sep.** Pekade på `~/Developer/openclaw-config/scripts/daily_leads.py` som inte finns på VPS:en, rapporterade ändå `ok`, och agenten improviserade flaggor. Ersatt av *Skyland nattlig påfyllnad* |
| ~~morning_brief_calendar~~ | — | **borttagen 5 sep.** Avstängd, utan schema, med fel — en rad som bara låg och lyste rött |
| Skyland morgonbrief | — | avstängd, uppgick i *Skyland morgon* |
| Daily Skill Update | 04:00 | avstängd. Föll på `Delivering to WhatsApp requires target`; larmmålet satt 5 sep |

**Larm vid tystnad:** **alla aktiva jobb** har `failure-alert` på WhatsApp (5 sep
fick Kundvakt och nattjobbet sina). Det var frånvaron av det som lät
kvällssammanfattningen krascha sju gånger i tystnad — och som lät `Skyland
nattliga leads` rapportera `ok` i dagar utan att göra något.

### Skyddsnäten (byggda 1 sep, efter femte Mac-sökvägsfelet)

Två vakter mot hela felklassen "gick sönder vid flytten, tyst":

1. **Morgonbriefen granskar schemat självt.** `check_cron.sh` i
   `proactive-checkin`-skillen listar jobb med fel i rad och jobb vars nästa
   körning ligger i det förflutna — VARNING-rader går överst i briefen.
   Store_key-buggen hade sett ut exakt så första morgonen.
2. **Preflight** (`openclaw-config/scripts/preflight.py`) — eget cronjobb 06:30,
   larm på WhatsApp efter ETT fel, larmvägen testad skarpt 1 sep. Hävdar: inga
   främmande maskinsökvägar i det agenterna läser och kör, `store_key` hör till
   maskinen, aktiva jobb har nästa körning i framtiden, nycklarna hämtbara via
   env.py, SCC svarar, morgonbriefens wrappar körbara. Kör den för hand efter
   varje flytt: `python3 ~/openclaw-config/scripts/preflight.py`.
   Föregångaren `preflight_tool_runtime.sh` hade själv en Mac-sökväg hårdkodad
   och letade efter himalaya — arkiverad.

Regeln de upprätthåller: **absoluta sökvägar utanför hemkatalogen får inte finnas
i något som Alex läser.** Skript hittar grannar relativt sig själva, wrappar bor i
skill-mappen, nycklar går via env.py.

### Kundvakten: tre Mac-rester i rad, inte modellen

Den hade sex fel i rad och gissningen var modelltimeout. Det var fel. Tre saker:

1. **`exec-approvals.json` pekade på Macens godkännandesocket**
   (`/Users/onepiecedad/.clawdbot/exec-approvals.sock`) med `ask: on-miss`. Agenten
   `kundvakt` saknades i filen, föll på defaults, och frågan om lov gick till en
   socket ingen lyssnar på. Körningen **hängde för evigt** i stället för att fela.
   Nu: `kundvakt` har samma nivå som syskonagenterna, och defaults står på
   `ask: off` + `askFallback: deny` — en server där ingen kan svara ska neka direkt,
   inte hänga.
2. **Agenten körde `python3 /Users/onepiecedad/clawd/scripts/kundvakt.py`**, en
   sökväg den mindes från Mac-tiden. Cron-prompten anger nu absolut Linux-sökväg.
3. **`kundvakt.py` läste bara `~/Developer/openclaw-config/.env`**, alltså Macens
   layout, och dog på "SCC_API_TOKEN saknas". Den provar nu `~/.openclaw/.env`,
   `~/openclaw-config/.env` och den gamla sökvägen i tur och ordning.

**Sjätte Mac-arvet (8 sep kväll): hjärtslaget pekade på Ollama.** `heartbeat.model` i
VPS:ens `openclaw.json` stod på `ollama/llama3.1:8b`, som bara fanns på Macen. Varje
hjärtslag (var 2:e timme) föll sedan flytten 31 aug med "Unknown model", och ibland
läckte felet ut i WhatsApp som "The configured model is unavailable" (00:32 den 8 sep).
Chatten påverkades inte, den kör Kimi. Bytt till `openrouter/google/gemini-2.5-flash`,
gateway omstartad 20:22, backup `openclaw.json.bak-heartbeat-8sep`. **Preflight har sedan 8 sep kväll kontroll 7:** varje modell i `openclaw.json` och
`agents/*/agent.json` slås upp hos sin leverantör (OpenRouter publikt, Google med nyckeln
i configen); `ollama/` och prefixlösa namn är FAIL, nätfel är VARNING. Första körningen
hittade **sjunde Mac-arvet**: `agents/deep-research/agent.json` bar `claude-sonnet-4-20250514`,
modellen som rensades ur openclaw.json 31 aug men överlevde i en agentfil. Modellraden är
borttagen (agenten ärver defaults, backup `agent.json.bak-8sep`); preflight rent, 31 av 31.
Svep samma kväll efter andra icke-sökvägsarv (macOS-kommandon, lokala portar, Mac-tjänster
i config): inget mer i det Alex kör. Kvar som text: `scripts/scc_poller.README.md` beskriver
launchctl, alltså Macens sätt att starta pollern; på VPS:en heter det systemd.

Samma dag städades sju agent-instruktionsfiler (`IDENTITY.md`, `HEARTBEAT.md`) från
`/Users/onepiecedad/...`. **Mönstret att leta efter när något slutar fungera efter en
flytt: en absolut sökväg till den gamla maskinen.** Det har nu förklarat sju separata
fel — pollern, mejlsignalen, kalendern, schemaläggarens `store_key`, kundvakten,
hjärtslagets modell och deep-research-agentens modell (de två sista är Mac-arv utan att
vara sökvägar; preflight kontroll 7 täcker den klassen). **Den gemensamma roten är att
konfigurationen skrevs för en maskin och kopierades till en annan.** Så länge repots
`openclaw.json` är Mac-formad (se skavankerna) kan alla sju komma tillbaka på en gång
vid en oförsiktig `deploy_openclaw_config.sh`.

## Namnbekräftelse i röstagenten (1 sep)

Skuggveckan avslöjade att en kontakt hette **"Joachim" på "Joachim Auto"** i CRM
— skapad 9 juli av röstagenten (`source: voice_call`) när Joakim testade henne.
Mallen skrev alltså ut rätt namn ur databasen; felet var transkriberingen. Två av
tre underkännanden i skuggveckan gick tillbaka på just den kontakten.

Åtgärdat: båda `scripts/site_agent_prompt*.md` kräver nu att agenten läser
tillbaka NAMN och företag och får dem bekräftade (stavning vid osäkerhet) innan
`book_meeting`, på samma sätt som mejladressen redan hanterades. Deployat till
`agent_8301…` (sv) och `agent_4501…` (en) med `create_site_agent.py`.
Testkontakten är omdöpt, taggad `test` + `stt-felstavning` och satt till `lost`.

## Alex i Server-läge: det är alltid klientens DNS (3 sep)

Symtom: `scc.skylandai.se` visar bannern "Server-läge — Alex kör i molnet med
full CRM-åtkomst", statusen står på **Ansluter…**, och sidopanelen är tom —
`0 skills`, `0 noder`, inga trådar. Alex svarar ändå, men bara med CRM.

**Server-läge är inte ett fel, det är reservläget.** `AlexView` sätter
`useBackendAlex = gateway.status !== 'connected' && gatewayGraceOver`. Kommer
inte WebSocket:en mot gatewayen upp inom grace-perioden pratar frontenden med
SCC-backenden i stället. Backenden har CRM men inga skills och inga sub-agenter
— de bor i gatewayen. Därav de tomma räknarna.

### Vägen fram till gatewayen, hela kedjan

| Led | Var | Status |
|---|---|---|
| Gatewayen | `openclaw-gateway.service` på VPS:en `alex` | binder **bara** `127.0.0.1:18789` och `[::1]:18789` (`openclaw.json`: `"mode": "local"`, `"tailscale": { "mode": "off" }`) |
| Framför den | `tailscale serve` → `https://alex.tail8a8e79.ts.net` | tailnet-only, proxar till `127.0.0.1:18789` |
| I bundlen | `VITE_GATEWAY_URL` | sätts i Render → bakas in av `ARG VITE_GATEWAY_URL` i `backend/Dockerfile` |
| I klienten | Tailscale med **accept-dns på** | annars går uppslaget av `*.ts.net` till publik DNS |

Alla fyra måste stämma. Gatewayen exponeras aldrig mot internet — den nås bara
av enheter som redan är med i tailnätet, och det är därför `VITE_GATEWAY_TOKEN`
får ligga i den publika bundlen (se motiveringen i `backend/Dockerfile`).
Kommentaren i `frontend/.env.production` som säger att gateway-URL:en aldrig får
bakas in gäller **funnel-adresser**, alltså publikt nåbara. Tailnet-adressen är
en annan riskklass, och den är den som används.

### Felet 3 sep, och hur det hittades

Bundlen var rätt hela tiden — `wss://alex.tail8a8e79.ts.net` låg i
`/assets/index-*.js`, ingen localhost-fallback. Gatewayen var uppe sedan 1 sep
08:25 UTC och jobbade. Felet satt i **Macens DNS**: Tailscale hade
`CorpDNS: false`, så Chrome frågade publik DNS efter `alex.tail8a8e79.ts.net`
och fick NXDOMAIN. Tailscales egen resolver på `100.100.100.100` svarade rätt
hela tiden, och `tailscale ping alex` gick fram — nätet var alltså aldrig nere,
bara namnuppslaget.

Åtgärd: `tailscale set --accept-dns=true` på Macen. Server-läget försvann direkt,
gatewayen gick grön, trådarna laddades.

### Felsök i den här ordningen — inte tvärtom

1. **Bundlen först.** `curl -s https://scc.skylandai.se/ | grep -o '/assets/index-[^"]*\.js'`,
   hämta den och `grep -o 'wss://[a-z0-9.-]*ts\.net'`. Står tailnet-adressen där
   är Render och Dockerfilen oskyldiga — läs aldrig `.env.production` som facit
   på vad som faktiskt byggdes.
2. **Klientens DNS.** `nslookup alex.tail8a8e79.ts.net` mot systemresolvern och
   mot `100.100.100.100`. Svarar bara den senare är `accept-dns` av.
3. **Tailnätet.** `tailscale ping alex`.
4. **Tjänsten sist.** `ssh alex@62.238.113.151 'systemctl --user is-active openclaw-gateway; ss -lntp | grep 18789'`.

Att porten är stängd på tailnet-IP:t (`nc -z 100.97.160.13 18789` misslyckas) är
**väntat och rätt** — gatewayen är loopback-bunden, `tailscale serve` tar 443.
Det är inget fel att jaga.

En SSH-tunnel (`ssh -L 18789:127.0.0.1:18789`) fungerar också, men är fel svar:
den binder Alex till en påslagen dator, och `tailscale serve` finns redan.

**Kvar att reda ut:** `0 skills`, `0 noder` och `Capabilities 0` står kvar även
med grön gateway. Anslutningen är alltså hel; registreringen av skills och noder
är en egen fråga.

## Dagsbudgeten räknade fel på den manuella kön (3 sep)

`OUTBOUND_DAILY_LIMIT` gällde inte för "Skicka nu" i Skuggvecka. Sju skuggrader
från 1 sep klickades iväg den 3 sep; efteråt svarade budgeträknaren fortfarande
**noll skickade idag**. Alla sju passerade utan att synas.

Orsaken: räkningen nycklade på `created_at`, alltså när *raden skapades*. För
maskinens egna utskick är det samma ögonblick som utskicket, men ett godkänt
skuggmejl behåller sitt `created_at` från dagen utkastet skrevs. En kö med gamla
skuggrader kunde därför klickas igenom i sin helhet utan att taket märkte något.

Det obehagliga var att räcket såg friskt ut. Det returnerade 429 helt korrekt för
sekvensmotorns utskick, som alltid har färskt `created_at`. Bara operatörsvägen
gick under radarn — och det är den väg som med flit saknar kill switch, eftersom
ett klick antas vara ett medvetet beslut. Antagandet håller för sju rader. Det
håller inte för en kö på femtio efter autosend-beslutet.

**Dessutom fanns räkningen i tre exemplar som hunnit glida isär:**

| Var | Filtrerade på | Fel |
|---|---|---|
| `services/comms.ts` | bara `direction=outbound` | räknade skuggutkast som utskick — bromsade för tidigt |
| `services/sequenceRunner.ts` | `status != 'shadow'` | räknade misslyckade utskick |
| `routes/sequences.ts` | `status = 'sent'` | rätt filter, fel tidsstämpel — hålet ovan |

Åtgärdat: en enda exporterad `countSentToday()` i `services/outreach.ts`, använd
av alla tre. Den räknar på **när mejlet gick**, inte när raden skapades — två
frågor summeras, maskinens utskick (`approved_at` saknas, `created_at` idag) plus
operatörens (`approved_at` idag), eftersom PostgREST inte kan filtrera på ett
`coalesce`-uttryck. Ingen rad kan hamna i båda.

Kontrollfråga när något ser konstigt ut med volymtaket — nya räknaren ska ge
samma siffra som denna:

```sql
with start as (select date_trunc('day', now() at time zone 'Europe/Stockholm')
                      at time zone 'Europe/Stockholm' as t)
select (select count(*) from messages, start where direction='outbound' and status='sent'
          and metadata->>'approved_at' is null and created_at >= start.t)
     + (select count(*) from messages, start where direction='outbound' and status='sent'
          and (metadata->>'approved_at')::timestamptz >= start.t) as skickat_idag;
```

Verifierat mot produktionsdata 3 sep: gamla räknaren 0, nya 7 — de sju bumparna.

**Läxa värd att bära vidare:** ett skyddsräck som bara testats på den ena vägen in
är inte testat. Maskinvägen och människovägen delar tak men inte kod, och det var
i springan mellan dem hålet satt.

## Vi mätte aldrig om mejlen lästes (5 sep)

Frågan var varför ingen svarade på öppnaren till de sju klinikerna. Svaret var
att frågan inte gick att ställa: `routes/emailInbound.ts` tog emot Resends
`delivered`, `opened` och `clicked` och kastade dem med ett 200. Systemet kunde
alltså inte skilja **"ingen öppnade"** från **"ingen mätte"** — och inte heller
veta om mejlen ens levererades, bara att Resend tagit emot dem för sändning.

Åtgärdat: händelserna registreras nu på utskicket i `messages.metadata` som
`delivered_at` / `opened_at` / `clicked_at`, plus `*_last_at` och `*_count`.
`status` rörs inte — den beskriver vad VI gjorde (sent/shadow/bounced), medan
det här är vad MOTTAGAREN gjorde. Blandas de blir båda oläsbara.

**Två förbehåll som avgör om detta ger något.** Öppningsspårning måste vara
påslagen i Resend, och webhooken måste prenumerera på just de händelsetyperna.
Är något av det av är koden stum — den registrerar det som kommer, och det
kommer ingenting. Kontrollera i Resend-panelen, inte i koden.

Och öppningssiffror överdriver alltid: Apple Mail Privacy Protection och många
företagsfilter hämtar bilder automatiskt, vilket ser ut som en öppning ingen
människa gjort. En hög siffra betyder därför lite. En NOLLA över en hel batch
betyder desto mer. `delivered` är däremot hårddata.

### Avsändarautentisering (kontrollerad 5 sep)

| Post | Läge |
|---|---|
| DKIM `resend._domainkey.send.skylandai.se` | finns |
| DMARC `_dmarc.send.skylandai.se` | finns, `p=none`, `rua=mailto:joakim@skylandai.se` |
| DMARC på organisationsdomänen `skylandai.se` | saknas |
| **SPF på `send.skylandai.se` och `skylandai.se`** | **saknas helt** |

Kontrollerat mot både 8.8.8.8 och 1.1.1.1. SPF-avsaknaden blockerar inget —
DKIM ensamt räcker för Gmail och Microsoft — men den kostar spampoäng gratis.
Posten som ska läggas på `send.skylandai.se` (bekräfta värdet mot Resends
DNS-sida, den visar exakt vad kontot kräver):

```
send.skylandai.se.  TXT  "v=spf1 include:amazonses.com ~all"
```

Eftersom `rua` pekar på Joakims egen adress finns dessutom DMARC-rapporter i
inkorgen som visar hur mottagarnas servrar faktiskt behandlade utskicken. Det
är riktig leveransdata som redan är betald för.

### Statistiken bakom "ingen svarade"

Sju utskick bär inte slutsatsen att copyn är fel. Vid en svarsfrekvens på 5–10
procent är sannolikheten för noll svar av sju mellan 48 och 70 procent — noll
svar är alltså det mest sannolika utfallet även för en bra kampanj. Underlag
för att döma texten kräver storleksordningen 50–100 utskick.

**Och där finns en cirkel att bryta:** Fas 4 (volym) startar inte förrän 3.6
(autosend) är beslutad, men 3.6 ska avgöras på ett underlag som bara volym kan
producera. Vägen ut är att skilja stegen åt — öppnaren på autosend för att bygga
urvalet, bump och avslut kvar i manuell kö, eftersom det var bumpen som visade
sig kunna missförstås.

## Autosend: öppnaren live, bump och avslut i manuell kö (beslut 5 sep)

Plan 3.6 avgjord. Öppnaren får gå utan godkännande; bump och avslut stannar
i Skuggvecka och kräver ett klick per meddelande.

**Varför just den gränsen.** Öppnaren är det enda steget som bär sin egen
kontext — den presenterar avsändaren och ställer sin fråga i samma andetag.
Bumpen gör det inte, och det kostade: Ambers Laserklinik svarade 4 sep med en
offert på 6000 kr för hårborttagning, eftersom frågan om deras prislista kom
utan avsändarram. Avslutsmejlet har hårdkodad text och säger därför minst av
allt om mallkvaliteten. Underlaget räckte aldrig till att döma hela sekvensen:
sju utskick, varav fyra med en kadens som aldrig var avsedd, ett svar som var
ett missförstånd, och noll svar som inte betyder något vid n=7.

### Mekaniken: `require_approval` per steg

Läget avgörs numera per steg, inte bara globalt. Ett `send_email` eller
`send_sms` vars config har `require_approval: true` loggas alltid som skuggrad
och väntar på "Skicka nu", oavsett `OUTBOUND_MODE`.

Kill switchen vinner ändå: är läget `off` förblir det `off`. **En flagga som gör
systemet försiktigare får aldrig kunna göra det djärvare** — det är regeln som
gör att den här sortens undantag är säkra att lägga till.

Satt på `Reaktivering — beauty` position 4 (bump) och 7 (avslut). Position 0
(öppnaren) är avsiktligt utan flagga.

Tre tester i `sequenceRunner.test.ts` bevakar grinden: live + flagga ger
skuggrad utan providerkall, live utan flagga skickar på riktigt, och
`OUTBOUND_ENABLED=false` ger `off` även med flaggan satt.

### Produktionsflaggor för autosend

| Variabel | Under skuggveckan | För autosend (satt 5 sep) |
|---|---|---|
| `OUTBOUND_MODE` | `shadow` | `auto` |
| `OUTBOUND_ENABLED` | `false` | `true` |
| `OUTBOUND_DAILY_LIMIT` | `5` | `20` (höjt 5 sep; huvudtabellen ovan är facit) |

Notera att det krävs **två** ändringar, inte en. `OUTBOUND_ENABLED=false` är
huvudströmbrytaren; med den av spelar läget ingen roll. Dagstaket räknar
sedan 5 sep även manuellt godkända utskick (se avsnittet om dagsbudgeten)
och är alltså ett verkligt tak för första gången. Gällande värde står i
huvudtabellen under "Produktionsflaggor" — den här tabellen är historik
över hur switchen slogs om.

### Vad som faktiskt händer när switchen slås om

Ingenting, tills nya kort enrollas. De sex aktiva enrollments står på position
6 och når aldrig öppnaren igen; deras nästa steg är avslutsmejlet, som är
flaggat. Fas 4 (volym) har inte börjat, så det finns inga nya kort. Switchen
armerar systemet för nästa batch — den startar ingen.

## Nattlig påfyllnad: kedjan fyller på sig själv (5 sep)

**Problemet var inte motorn, det var bränslet.** Systemet kunde skicka, mäta och
stoppa på svar, men ingenting fyllde på med nya kort. Sju kliniker är inget
underlag: vid 5–10 % svarsfrekvens är sannolikheten att sju utskick ger noll svar
ungefär hälften till två tredjedelar. Autosend hade inget att göra.

**Jobb:** `Skyland nattlig påfyllnad`, 02:00 Europe/Stockholm,
`payload_kind=command` → `python3 ~/.openclaw/skills/scc-crm/scripts/daily_fill.py`.
WhatsApp-larm efter första felet. Ingen leverans av utskriften (den blir hundratals
rader); rapporten går till `~/clawd/out/leads/fill-<datum>.md` och till SCC som
aktiviteten `outreach.daily_fill`.

**Föregångaren, `Skyland nattliga leads`, var avstängd 5 sep.** Den var en
agentprompt: "starta lead-motorn ... kör exakt via exec: nohup python3
~/Developer/openclaw-config/scripts/daily_leads.py". Den sökvägen finns inte på
VPS:en. Jobbet rapporterade ändå `ok` varje natt, eftersom agenten bara skulle
bekräfta att processen startat. Någon natt löste agenten problemet genom att
hitta på flaggor till `discover_pipeline.py` (`--count --format json
--output-dir`) som inte finns, och en annan natt körde den en tattoo-sökning på
tre kort. **Ett cron-jobb ska köra ett kommando, inte be en modell köra ett
kommando.**

Fem steg, var och en avstängbar med `--skip`:

1. `discover` — nästa ort ur `verticals/beauty-reaktivering.json` → `cities`
   (26 orter, Göteborgsområdet först). Rotationen i
   `~/.openclaw/state/daily_fill.json`. Hoppas över när kön obearbetade kort med
   mejl passerat 30.
2. `mejl` — `email_enrich.py`. **21 av 41 beauty-kort saknade mejladress** och
   kunde därför aldrig skrivas in i en mejlsekvens. discover skrapar bara
   startsidan; adressen ligger på /kontakt eller i en mailto-länk.
3. `research` — `prospect_batch --require-email --limit N`. Kort utan mejl får
   ingen research: det är att betala för något som ändå inte kan användas.
4. `doktrin` — se nedan.
5. `enroll` — kompletta kort skrivs in i sekvensen.

### Doktringrinden: ett komplett kort kan bära fel brev

**25 av 33 beauty-kort med DM bar nykundspitchen** ("skulle ni ha plats för fler
kunder?"), inte reaktiveringsfrågan. Åtta av dem hade mejladress. Hade
nattjobbet enrollat på "har mejl + har DM" hade en kapacitetsfråga till en ny
kund gått ut under ämnesraden *"Snabb fråga om era kunder från förra året"*.

Doktrinen fanns bara inbakad i fritexten `custom.dm_hook_source`
(`dm_pipeline (modell, beauty, validerad) 2026-08-30`). Ett filter som måste
strängmatcha fritext släpper förr eller senare igenom fel sak. `dm_pipeline`
skriver den nu som eget fält, `custom.dm_vertical`; grinden läser det och faller
tillbaka på fritexten för äldre kort. Bara `beauty-reaktivering` släpps in.
Steg 4 skriver om felaktiga kort ur den research som redan är betald.

**Rör aldrig grinden för att få in fler kort.** Kön är ett symptom.

### Stadiegrinden: operatörens "No Fit" är data

Första skarpa körningen (5 sep) skrev in **Hudmottagningen Citysjukhuset +7** i
mejlsekvensen. Kortet låg i **No Fit** — någon hade redan dömt bort det. Grinden
läste taggen `niche:beauty` och struntade i stadiet. Mejlet hade gått ut måndag
morgon; enrollmentet är avslutat med `exit_reason='no_fit_stage'`.

Samma fel gjorde två saker till, tyst:
- backpressuren räknade nio No Fit-kort som obearbetad kö, så discover hade
  stängts av för en hög ingen någonsin skulle beta av
- research-räkningen sa "6 kort att köra" medan `prospect_batch`, som letar i
  New Prospect-kolumnen, hittade noll. **Två räknesätt för samma sak.**

Nu läses pipelinen en gång per körning. `OPEN_STAGES = New Prospect, Qualified,
Outreach Ready` — bara de får bearbetas och skrivas in.

### Första skarpa körningen (5 sep, `--skip discover`)

7 mejladresser hittade (21 kort utan adress → 14), 8 DM omskrivna till rätt
doktrin, 8 kort inskrivna (9 minus det bortdömda). Väggtid 13 min. Öppnarna går
ut måndag 7 sep 08–09 — lördag ligger utanför utskicksfönstret, och det syns på
att motorn själv sköt fram dem.

Ett fynd på köpet: researchern flaggade `IDENTITET_FEL` på **Pro Clinique** —
kortets `area` säger göteborg men profilen och adressen är Borås. Kortets ort
stämmer inte alltid med verkligheten, och öppnaren skriver ut orten.

### allow_reenroll=false betydde en gång i taget

Databasens unik-spärr gäller bara AKTIVA enrollments. En kontakt som gått hela
sekvensen — eller hoppat ur för att den SVARAT — gick att skriva in på nytt och
fick samma brev igen. Osynligt så länge påfyllningen var manuell; med ett
nattjobb är det ett brev till någon som redan sagt sitt. `enrollContact` läser
nu sekvensens `allow_reenroll` och nekar på historik oavsett status.

### Aktivitetsloggen gick inte att skriva till

`/api/v1/activities` (Supabase) var läs-bar. POST fanns bara på den gamla
minnesmocken `/api/activities`, så allt som loggade dit försvann vid omstart.
POST finns nu på den riktiga, bakom samma auth som resten av `/api/v1`.

## Uppdateringar installerar sig inte själva, med flit (5 sep)

OpenClaw har `openclaw update --yes`, som startar om gatewayen på egen hand. Den
går att lägga i cron. **Gör inte det.**

Gatewayen kör nattjobbet, cron-schemat, skills och WhatsApp-kanalen som alla
larm går över. Uppgraderar den sig själv 04:00 och går sönder, är maskinen som
ska säga till samma maskin som just gick sönder — och larmvägen dog med den. Du
får veta det nästa gång du råkar öppna dashboarden.

Delningen: **upptäckten automatiseras, knapptrycket inte.**
`proactive-checkin/scripts/check_maskin.sh` (fjärde wrappern, ny 5 sep) körs av
morgonbriefen 07:00 och rapporterar ny version, mediemappens storlek och ledig
disk som `VARNING:`-rader, som går överst i briefen. Den installerar ingenting
och raderar ingenting. Morgonbriefens prompt förbjuder det uttryckligen.

Trösklar: media 2 048 MB (`MEDIA_TAK_MB`), disk 15 % ledigt (`DISK_MIN_PCT`).

### Mediemappen städas inte automatiskt, också med flit

`~/.openclaw/media/inbound/` är 37 MB i 304 filer mot 63 GB ledigt. Det är inget
problem att lösa, och innehållet är skälet att inte lösa det ändå: **205 jpg,
20 png, 9 pdf och 6 docx** vid sidan av de 61 röstnoterna. Röstnotens text finns
kvar i sessionen, så där förloras ingenting. Bilden och PDF:en finns bara som
fil, och en beskrivning av en bild är inte bilden.

En tröskel som säger till är ärligare än ett schema som slänger i förväg. Skulle
städning ändå behövas är bara två saker säkra att ta automatiskt: arbetskopiorna
i `~/clawd/media/inbound/openclaw-staged-*` (dubbletter per definition) och
`.ogg` äldre än 90 dagar. Bilder och dokument aldrig.

### Chattens "Outside allowed folders" på röstmeddelanden

Inkommande media landar i `~/.openclaw/media/inbound/` och stageras till en
arbetskopia under arbetsytan `~/clawd/media/inbound/openclaw-staged-*/`. Agenten
läser arbetskopian och transkriberar korrekt, men chattvyn länkar till
originalet, som ligger utanför de mappar dashboarden får servera. Uppspelningen
failar, meddelandet gör det inte. Kosmetiskt.

### preflight failade på en beskrivning av buggen den letar efter

`scc-crm/references/sajtandringar.md` beskriver sökvägsbuggen och innehöll därför
`/Users/onepiecedad/...` ordagrant. Kontrollen kan inte skilja en bugg från en
beskrivning av en bugg, och **ska inte behöva det** — ett undantagsregister
ruttnar. Texten säger `/Users/<utvecklare>/` nu och kontrollen förblir
undantagslös.

## WhatsApp-intag för Cold Experience (Dualhook → `ce-agent-webhook`, beslutat 8 sep)

**Trafiken ägs av Supabase-funktionen `ce-agent-webhook`.** Beslut 8 sep kväll:
Dualhooks Webhook Override pekar dit, agentlogiken (fyra språk, het-lead-detektion,
`ce_leads`/`ce_messages`) bor där, och CRM-korten uppstår genom speglingen
`ce_mirror_lead`/`ce_mirror_message` (se `crm-spegling.md`). Gustavs leads hamnar
alltså i det vanliga CRM:et, i pipelinen `Cold Experience — leads` (id `1541531a…`,
tenant `cold-experience`, Ny → Kvalificerad → Het → Överlämnad → Bokad → Betald →
Avböjt), men vägen in är `ce_*`-tabellerna, inte SCC-routen.

**SCC:s `/api/v1/webhooks/whatsapp` (`routes/whatsappWebhook.ts`) är EJ I DRIFT.**
Byggd 5 sep för den manuella Meta-vägen som lämnades 8 sep. Ingen webhook pekar på
den, `WHATSAPP_*`-variablerna i Render är avsiktligt tomma, och de ska förbli det:
två mottagare för samma trafik är samma felklass som två ingest-vägar för sajten.
Koden och de 27 testerna får ligga kvar som reserv (den är tenant-generisk och kan
bli vägen för en andra WhatsApp-kund), men rör den inte för Cold Experience.
Tabellen nedan beskriver vad den routen *skulle* göra, som referens.

| Händelse (SCC-routen, ej i drift) | Vad som händer |
|---|---|
| Inkommande meddelande | tenant ur `phone_number_id` (→ `tenants.config.whatsapp_phone_number_id`), annars `WHATSAPP_TENANT_SLUG`. Kontakt på `custom.wa_id`, i andra hand på telefon (plus och mellanslag tas bort, `wa_id` lärs in). Saknas den skapas den: namn ur WhatsApp-profilen, telefon `+<wa_id>`, `source` `whatsapp` eller `whatsapp_ctwa`, `dedupe_key` `wa:<tenant>:<wa_id>`. Öppet kort i tenantens pipeline (`config.whatsapp_pipeline` eller den äldsta) i första stadiet om inget finns. Rad i `messages` (`channel=whatsapp`, `provider_message_id=wamid`, `metadata.contact_id`). Auto-todo "Svara …". |
| Bild/röst/video/dokument/plats/knapp | läsbar rad (`[bild]`, `[röstmeddelande]`, knappens text …), media-id i `metadata.media_id`. Tråden visar aldrig en tom rad. |
| CTWA-referral (annons) | `contacts.custom.ad_referral` **vid första beröringen, skrivs aldrig över.** Det är provisionsunderlaget. Taggen `ctwa`. |
| Status (`sent`/`delivered`/`read`/`failed`) | uppdaterar vårt utgående på `provider_message_id`. `read` räknas som `delivered`. Går aldrig bakåt. Fel sparas i `metadata.error`. |
| Omleverans | dedupe på `wamid` — Meta levererar om vid minsta tvekan. |

**Svarsväg (SCC-routen, ej i drift):** `POST /api/v1/whatsapp/send` och
`GET /api/v1/whatsapp/window/:contactId` hör till samma reservkod. Utgående för
Cold Experience går via Dualhooks API-nyckel från Supabase-funktionen; sändvägen
är **inte verifierad** än (se Tjänster). 24-timmarsfönstret räknas ur tråden;
utanför fönstret krävs godkänd mall, inte byggt.

**Vägvalet gjordes 8 sep: Dualhook.** Meta-sidan görs INTE för hand längre. Numret
kunde inte registreras direkt på Cloud API utan att Gustav förlorar WhatsApp
Business-appen, och egen App Review (Tech Provider) tar dagar till veckor.
Dualhook kör Embedded Signup med coexistence på sin egen Meta-app. Se raden i
Tjänster och `~/.openclaw/skills/scc-crm/references/tekniska-forutsattningar.md`,
avsnittet "Vägvalet: Dualhook". **Tre villkor som bryter kopplingen:** Business-appen
på kontantkortstelefonen måste öppnas minst var 13:e dag, historiksynken måste bli
klar inom ett dygn, och avinstalleras appen bryts kopplingen permanent. Ingen av
dem har ett larm i dag.

**Jobbkön `ce_jobs` har en klocka sedan 8 sep kväll.** pg_cron + pg_net i Supabase anropar
`ce-agent-webhook?run_jobs=1` (var 5:e min, :00) och `meta-leads-webhook?run_jobs=1` (var 5:e
min, :02). Innan dess kördes kön bara efter nästa inkommande webhook, så ett utskick i lugn
period låg tills nästa gäst hörde av sig. Migration `database/migrations/20260908_ce_jobs_cron.sql`.
Kontroll: `select * from cron.job_run_details order by start_time desc limit 5`.

**Leadkortets deadline i svensk lokal tid sedan 8 sep kväll** (`ce-agent-webhook` v16). Var
hårdkodat UTC+2, hade gett en timme fel dec–apr. Funktionernas källkod ligger nu i
`openclaw-config/skills/scc-crm/functions/` och är md5-identisk med driften; **hämta driftens
version och diffa innan varje deploy** (lokala `prompt.ts` låg en version efter driften 7–8 sep).

**Kvar, i den här ordningen:**

1. **Gustav kopplar in numret** i Dualhook, på telefonen med kontantkortet.
   Cirka tjugo minuter, han har en egen instruktion. Vill han ha huvudkontot på
   sin egen telefon ska det flyttas FÖRE inkopplingen, inte efter. Därefter sätter
   Joakim webhook-adressen
   (`https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/ce-agent-webhook`)
   och lägger API-nyckeln som hemlighet i Supabase. Provperioden slutar 22 sep.
2. Mallar (utanför 24 h) — kräver godkända templates hos Meta.
3. Agenten: svar på fyra språk, het-lead-detektion, överlämning till Gustav.
   Hakar i tråden när den finns.
4. Kortet: språk, fönster öppet/stängt, när en människa tog över. Fält, inte
   en ny vy.

**Tester:** `services/whatsapp.test.ts` (13, rena funktioner) och
`__tests__/whatsappWebhook.test.ts` (14, mot en databasfejk i minnet:
`__tests__/helpers/fakeSupabase.ts` — den ser vad som *händer*, inte bara att
ett anrop gjordes).

## Intresserade svar larmar direkt (plan 3.1 klar, 6 sep)

Klassificeraren flyttade kortet och spärrade nej, men ingen sa till. Digesten
kommer 07:00 och Skuggvecka kräver att man tittar — för ett "ja, berätta mer" är
båda för sent. Nu larmar `services/operatorAlert.ts` på två vägar samtidigt:

- **WhatsApp via Alex.** SCC skapar en `claw:notify`-uppgift (input: `{channel,
  to, text}`) och dispatchar den till `pull:queued`. Pollern på VPS:en hämtar den
  via `/claw/pending`, känner igen `agent_id=notify` och skickar den till
  gatewayen med `deliver:true` + `to` + `channel`, plus en uttrycklig instruktion
  i texten om att leverera ordagrant. Pollern kvitterar själv via
  `/claw/task-result` — agenten ska bara leverera, inte hålla reda på run-id.
- **Mejl via Resend** till `EMAIL_FORWARD_TO`, direkt via providern (internt larm:
  rör inte dagsbudget eller `OUTBOUND_ENABLED`). Går fram även om gatewayen sover.

Flaggor: `OPERATOR_ALERTS_ENABLED` (default `true`) och `OPERATOR_WHATSAPP_TO`
(numret; utan det hoppas WhatsApp-vägen över och bara mejlet går).

**Två nummer — använd WhatsApp-numret.** Joakim har `+46737329083` (WhatsApp
ligger på det, fortfarande aktivt) och `+46735643495` (telefonen han ringer
från). Larmen ska till WhatsApp-numret: `OPERATOR_WHATSAPP_TO=+46737329083`.
Det stämmer med gatewayens kanal i `openclaw.json` (`allowFrom`,
`groupAllowFrom`, `dmPolicy: allowlist`, `selfChatMode: true`) — inget behöver
ändras där. (`skills/phone-voice/bridge/contacts.json` märker samma nummer
"Björn"; fel etikett i en annan skill, rör inte WhatsApp-kanalen.)

Dedupe på `reply.interested:<contact_id>` i 24 h — ett kort larmar en gång även om
svaret klassas om. Varje larm loggas som activity `operator.alert` med vilka vägar
som gick fram. Larmet kan aldrig fälla klassificeringen: alla fel sväljs och loggas.

**Verifiera efter deploy** (kräver att `OPERATOR_WHATSAPP_TO` är satt i Render):

```bash
# Ett testlarm hela vägen ut — skapar en riktig claw:notify-uppgift.
curl -s -X POST -H "Authorization: Bearer $SCC_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Testlarm","description":"3.1-verifiering","executor":"claw:notify","status":"created",
       "input":{"channel":"whatsapp","to":"+46737329083","text":"Testlarm från SCC"}}' \
  https://scc.skylandai.se/api/v1/tasks
# dispatcha id:t som kom tillbaka, vänta ≤15 s (pollerns intervall), kolla WhatsApp.
```

Kommer larmet inte fram men uppgiften blir `completed`: gatewayversionen hedrar
inte `deliver/to/channel` från hooken. Då är rätt fix att låta `skyland`-agenten
skicka meddelandet med sitt eget WhatsApp-verktyg i stället — texten i uppdraget
säger redan åt den att göra det.

## Attribution: från utskick till bokning till provision (6 sep)

Kedjan gick redan att följa per kort (`GET /api/v1/attribution/:contactId/timeline`),
men ingen vy svarade på *vilka orter, doktriner, textvarianter och poängband som ger
svar och möten*, och en bokning visste inte själv vilket utskick som ledde dit.
Migration `20260906_attribution.sql` (applicerad 6 sep):

- **`v_outreach_funnel`** — en rad per enrollment: ort (`custom.area`), doktrin
  (`custom.dm_vertical`), textvariant (`custom.dm_variant`), poäng, researchkostnad,
  skickat, svar, senaste klassade intent, bokningar, affärsstatus.
- **`bookings.attributed_*`** — vid `created` stämplar bokningsspegeln det senaste
  skickade meddelandet till kontakten inom 90 dagar (`attributed_message_id`,
  `attributed_enrollment_id`, `attributed_touch_at`). Skrivs bara vid ny bokning,
  aldrig vid avbokning. Inget utskick i fönstret = ingen stämpel, inget fel.
- **`bookings.paid_confirmed_at / paid_value_sek / commission_sek`** — operatörens
  bekräftelse att bokningen blev betald och vilken provision som gäller (SCC-39).

Endpoints (bakom global auth):

| Anrop | Ger |
|---|---|
| `GET /api/v1/attribution/outreach?group_by=area` | Tratt per ort. `group_by`: `area`, `dm_vertical`, `dm_variant`, `sequence_name`, `score_band`, `none`. `&sequence=beauty`, `&since=2026-09-01`, `&format=csv`, `&rows=1` (råraderna). |
| `GET /api/v1/attribution/commission/:customerId` | Provisionsunderlag per kund: varje bokning, vilket utskick som ledde dit, bekräftad betalning, provision. `&format=csv` = fakturabilaga. |
| `POST /api/v1/attribution/bookings/:id/confirm` | `{confirmed, paid_value_sek, commission_sek}` — bekräfta betald/genomförd. |
| `POST /api/v1/attribution/replies/:contactId/intent` | `{intent, note}` — operatörens facit på klassningen. Ambers lästes som `interested` men var ett missförstånd; sätt `other` så räknas det inte som säljsvar. Vyn tar senaste klassningen. |

Snabbkoll: `SCC_API_TOKEN=… curl -s -H "Authorization: Bearer $SCC_API_TOKEN" "https://scc.skylandai.se/api/v1/attribution/outreach?group_by=area&sequence=beauty"`.
Läget 6 sep: 23 inskrivna i Göteborg, 14 skickade, 1 svar (klassat interested — ska sättas
till `other`), 0 bokningar, 0,37 USD i research. Beslutspunkten är 50 skickade öppnare.

## Dagsbudgeten är per avsändardomän, inte global (8 sep)

`countSentToday` räknade varje rad med `direction='outbound'` sedan midnatt, utan filter på kund,
kanal eller avsändare. Två fel följde: Cold Experience och beautykampanjen delade tak trots skilda
avsändardomäner, och Gustav-robotens Messenger-svar räknades som kall mejlutkorg eftersom de
speglas som outbound-rader. Med autopiloten påslagen hade robotens prat strypt beautykampanjen
tyst.

Varje utskick bär nu sin hink i `metadata.budget_key`:

| Hink | Vad som dras från den |
|---|---|
| `email:send.skylandai.se` | Skylands egen utkorg, plus **all mejlhistorik från före 8 sep** (rader utan `budget_key` ärvs bara av standarddomänen) |
| `email:coldexperience.se` | Cold Experience-mejl från Gustav |
| `sms` | Alla SMS, oavsett kund |

Räkningen filtrerar på hink **plus kanal**, så en spegelrad (`channel='messenger'`) kan aldrig
hamna i en mejlhink oavsett metadata. Messenger och WhatsApp har ingen hink alls och räknas inte:
de går inte över någon mejldomän och har egna gränser hos Meta. Transaktionell post *räknas* i
hinken men *blockeras* aldrig av den — en brevlåda ser ingen skillnad på bokningsbekräftelse och
utkorg, men en påminnelse ska aldrig fastna bakom kalla mejl.

**Avsändare per steg.** `step.config.from` går hela vägen genom sekvensmotorn, skuggraden och
operatörens Skicka nu. Utan den gick allt från `EMAIL_FROM`, alltså hade ett Cold Experience-mejl
lämnat systemet som `joakim@send.skylandai.se`.

**Utanför räkningen:** `meta-leads-webhook` anropar Resend direkt och rör aldrig budgeten. Rimligt
för ett direktsvar på ett inskickat formulär, men volymen mot coldexperience.se räknas ingenstans.

## Cold Experience: mejlsekvensen till de befintliga trettio (8 sep)

Sekvens `dca1fb3f-6486-45dd-bbf2-b96c8211e206`, **status `draft`**, `trigger_type = manual`,
noll inskrivna. Mejl 1 ur kortets `custom.dm_hook` → 3 dagars uppehåll → avhopp vid svar → mejl 2
→ slut. Avsändare `Gustav Hedman <gustav@coldexperience.se>`, `require_approval` på båda utskicken.
Ämnesrad ur `custom.ce_subject` via `{{custom.nyckel}}` i `render()`.

Tre spärrar mellan här och en riktig gäst: sekvensen är draft, varje mejl kräver ett klick i
Skuggvecka, och dagsbudgeten gäller.

**Nya leads går inte hit.** Dem svarar `functions/meta-leads-webhook/email.ts` på direkt vid
formulärinlämning när `ce_settings.autopilot` slås på. `trigger_type = manual` gör att de två
flödena inte kan krocka. Flödena delar ämnesrader men inte avsändare (`gustav@` respektive
`info@`), eftersom breven är skrivna i olika röst.

**Speglingen skriver fortfarande över `contacts.tags` helt.** `custom` slås ihop sedan 8 sep, men
tags gör det inte. Därför använder sekvensen varken `add_tag` eller `move_stage` — stegen i
pipelinen ägs av speglingen och hade dragit åt olika håll.

## WhatsApp: signaturkontrollen är delad efter avsändare (8–9 sep)

`ce-agent-webhook` verifierade Metas `X-Hub-Signature-256` mot `META_APP_SECRET` för
all trafik. Efter WhatsApp-inkopplingen 8 sep avvisades varje inkommande
WhatsApp-meddelande med `401 bad signature`, och det gick inte att laga genom att hämta
rätt hemlighet: numret onboardades genom Dualhooks Embedded Signup, så Meta signerar med
**Dualhooks** app-hemlighet, som är delad mellan alla deras kunder och aldrig lämnas ut.
Citat och källa i `~/.openclaw/skills/scc-crm/references/tekniska-forutsattningar.md`.

**Åtgärdat 9 sep.** Att bara ta bort `META_APP_SECRET` vore fel, för Facebook-sidan
ligger kvar på Cold Experiences egen app och verifieras korrekt. Kontrollen är därför
delad på `payload.object`:

| Objekt | Kontroll |
|---|---|
| `page` | Signaturen mot `META_APP_SECRET`, oförändrat. Rör inte den grenen. |
| `whatsapp_business_account` | `entry[].id` mot `CE_WABA_ID` och `metadata.phone_number_id` mot `CE_PHONE_NUMBER_ID`. Kontohändelser som `account_update` saknar phone_number_id; där räcker WABA-id, annars avvisas Metas egna kontomeddelanden. |
| annat | Kvitteras med `received: 0` utan att röra något. |

Defaultvärdena i koden är Cold Experiences riktiga id:n (`1021280300798738` och
`1289813200882119`), så inga nya hemligheter behövs för att det ska fungera.

**Id-kontroll räcker inte som enda skydd**, eftersom WABA-id inte är hemligt. Därför
finns `CE_WEBHOOK_KEY`: sätts den krävs `?k=<nyckel>` på varje POST, annars 403. Tom som
default så att adressen kan bytas hos Dualhook utan avbrott. **Sätt den, och lägg samma
nyckel i Webhook URL hos Dualhook.** Tills dess är adressen ett gissningsbart funktionsnamn.

Verifierat mot prod i sju fall: rätt WABA och nummer 200, fel WABA 401, fel nummer 401,
`account_update` utan metadata 200, sidan med trasig signatur 401, okänd objekttyp 200,
GET-handskakning med fel token 403.

**Kvar:** `dh_live`-nyckeln i Dualhook för utgående. Utan den kan vi ta emot men inte svara.

**Driftregel som följer av samma inkoppling:** länkade enheter loggas ut vid inkoppling och
kan länkas om, men WhatsApp för Windows och WearOS stöds inte och utlöser inga
`smb_message_echoes`. Vår `markHumanActive` bygger på de ekona för att veta att en
människa svarat. Gustav har iPhone och Mac; Mac står inte på listan över klienter utan
stöd, men det är **otestat** och ska verifieras med ett riktigt meddelande innan
autopiloten slås på.

## WhatsApp: kopplingen revs efter 27 sekunder, och tre saker som byggdes under utredningen (9 sep)

Kopplingen 8 sep levde i noll sekunder. Meta rev partnertilldelningen 23:18, 27 sekunder
efter att Dualhook slutfört signupen, och 401:an i loggen var `ACCOUNT_OFFBOARDED`, inte ett
gästmeddelande. Ingen WhatsApp-trafik har nått oss. Hela utredningen, tidslinjen från tre
källor och Dualhooks svar står i `scc-crm/references/tekniska-forutsattningar.md` under
"Kopplingen revs 27 sekunder efter inkopplingen". Kort: orsaken är inte fastställd,
arbetshypotesen är tre Embedded Signup-fönster på samma minut, och Dualhook-kontot måste
ägas av Cold Experience, inte Skyland, så nästa försök görs från Gustavs eget konto.

Tre saker som driftar från och med nu:

**`ce_account_events`** (migration `20260909075516`). Kontohändelser från Meta och Dualhook
som inte hör till ett lead: `account_update` (`ACCOUNT_OFFBOARDED`, `PARTNER_REMOVED`,
`PARTNER_APP_INSTALLED` ...), kvalitet, granskning, och okända `object`-typer. Append-only med
samma `app.allow_event_purge`-lucka som `ce_lead_events`. `ce-agent-webhook` skriver dit och
mejlar `ALERT_EMAIL` (default joakim@skylandai.se) via Resend med LARM/VARNING/INFO i ämnet;
sms bara om `ALERT_SMS_TO` är satt. Tystnaden 8 sep kostade ett dygn; den ska inte upprepas.
**Öppet:** Dualhooks vidarebefordrade livscykelhändelser har inte verifierad form. Kommer de
med ett annat `object` än `whatsapp_business_account` landar de som VARNING med hela
payloaden, och koden får anpassas efter första exemplaret.

**Mutning per lead.** `ce_leads.custom.agent_muted = true` tystar agenten helt i den tråden,
före autopilotgrinden. Behövdes för att `handed_off` inte stoppar något: den byter en rad i
systemprompten och lämnar prislistan kvar. Ett kort där Gustav förhandlat eget pris hade fått
listpris av roboten så fort autopiloten slogs på. Verifierat skarpt mot driftsatt funktion.
Satt på Boukje Nienhuis (5 500 EUR, kortet i Överlämnad, `wa_id 31626961839`). Mutningen syns
inte på kortet i CRM:et; speglingen lyfter bara `ce_*`-nycklar.

**Prompt `2026-09-09.1`.** Boukje-tråden gav ett verkligt femdagarsprogram dag för dag, vad
sjudagarspaketet lägger till, flygplatshämtning, flyghjälp, hur en preliminär bokning går till,
och att erbjuda skrift om gästens talade engelska inte räcker. Rabattgreppen Gustav använde
(bort med hundspannet, sextonåring som barn, gratis extradag, ombyggt paket) är dokumenterade
i `gustav-ton.md` 4e som **hans**, inte robotens.

## Kända skavanker

- **SCC deployas av Render, inte av Netlify (förtydligat 9 sep).** Står redan i infrastrukturtabellen och i "Prod = Render. Inget annat.", men det är värt att säga en gång till här, eftersom skavanken nedan handlar om `coldexperience` och lätt läses som att den skulle gälla SCC. Den gör den inte. SCC autodeployar från `main` vid varje push, typiskt 45 till 60 sekunder, och deploy-listan i Render visar commiten. Vill man veta om något är ute: jämför commit-hashen där, inte bundlenamnet i webbläsaren.
- **`coldexperience` på Netlify bygger inte om vid push till `main` (7 sep).** *Gäller Gustavs sajt coldexperience.se, inte SCC.* Allt på Netlify-sidan är kontrollerat och rätt: repot kopplat till `Onepiecedad/ColdExperience`, Build status Active, produktionsgren `main`, base `frontend`, publish `frontend/build`, functions `frontend/netlify/functions`, inget `ignore`-kommando i `frontend/netlify.toml`, inget skip i commit-meddelandet. Manuell "Trigger deploy" hämtar rätt commit och fungerar. Kvarstående misstanke: Netlifys GitHub-app saknar tillgång till just det repot (github.com/settings/installations), eller att webhooken hos GitHub tappats. Tills det är löst kräver varje deploy ett klick. MarinMekaniker och SCC autodeployar normalt.
- **Edge-funktionen `web-ingest` i Supabase är död kod (7 sep).** Byggdes som ett första försök till flerkundsintag innan det visade sig att `/api/v1/webhooks/site/*` redan fanns och skulle användas. Inget pekar på den. Radera den i dashboarden; två ingest-vägar för samma sak är samma felklass som `ce_*`.
- **Sajtnyckel + origin är inget lås.** Kontrollen stoppar andra webbplatsers besökare, inte curl med egen `Origin`-header. Konsekvens: någon kan skriva in påhittad telemetri. Ingen data läcker, och att skicka helt utan nyckel landar som skyland precis som förut — endpointen var publik redan innan. Riktig åtgärd är signerade anrop, eget ticket.
- **CORS-avslag ger 500, inte 403.** `server.ts` kastar ett `Error` i origin-callbacken, felhanteraren gör 500 av det. Blockerar korrekt men bullrar i loggen och kan maskera riktiga fel. Gäller alla endpoints, inte bara sajtintaget.
- **Git via en monterad mapp från en molnsession fungerar inte (8 sep).** Linux-VM:en som `device_bash` kör i får inte radera filer, så varje skrivande git-kommando lämnar en `.lock` som blockerar nästa. Kör git mot repot genom Desktop Commander i stället — det skalet kör som användaren på macOS och har fulla rättigheter.
- **`send.coldexperience.se` tillhör en annan leverantör.** CNAME till `send.forge.rmta.net` med egen MX och SPF, alltså en färdig Return-Path för något Cold Experience redan använder. Rör den inte. Konsekvensen är att Resend använder sin delade Return-Path: DKIM på `resend._domainkey.coldexperience.se` bär DMARC-alignmenten ensamt. Håller på `p=none`, men det är ett ben i stället för två. Vill man ha det andra krävs en Return-Path-subdomän med en annan etikett än `send`.
- `backend/src/routes/skills.test.ts`: två tester röda på main (slår mot riktig DB). Inte relaterat till sajt/reaktivering.
- Frontendens `*.test.tsx` saknar jest-dom-typer (tsc rött bara i testfiler; `vite build` grönt).
- Commit `b1cda98` fick med tre lokala ändringar som låg okommittade (`backend/src/index.ts` legacy, `docs/HANDOVER_2026-07-27.md`, `docs/IG_DM_AUTOMATION.md`).
- Integrationshälsan: `n8n:*`-checkarna är borta (2.1b, 30 aug). Nya: `site:skylandai.se`, `site:lang.js` (båda agent-id:na), `site:agent-tools` (självtest över publika adressen med X-Skyland-Key), `elevenlabs:site-agents`. Agent-id:n är hårdkodade i `services/integrationHealth.ts` — byter du agent, byt där + `lang.js` + SITE_FLOWS.
- `GET /api/v1/website/workflows` (Sajt-fliken, "n8n Workflow-hälsa") pekar fortfarande på n8n:s API. Död — visar tomt. Riv eller byt mot `activities` från sajt-webhookarna. Sedan 7 sep anropas den inte alls från kundkortens Hemsida-flik (`visaWorkflows={false}`), bara från Skylands egen vy.
- Engelska röstagenten är otestad i skarpt samtal.
- **Deploy till VPS:en: nyckel + ett kommando (7 sep 2026).** Verktyget finns i repot; själva nyckeln sätts upp en gång enligt `openclaw-config/vps/DEPLOY_NYCKEL.md` (ed25519 på VPS:en → skrivskyddad deploy key på GitHub → origin över SSH). Därefter är deploy `ssh alex@62.238.113.151 '~/openclaw-config/scripts/deploy_vps.sh'`: hämtar main, synkar skills till `~/.openclaw/skills`, startar om gateway och poller, verifierar att båda är `active`. Vägrar om en pipeline kör eller om VPS-repot har lokala ändringar. `sync_skills.sh` härleder numera repot ur sin egen plats, så `REPO_SKILLS=` behövs inte längre. **Är nyckeln inte uppsatt felar pullen med "could not read Username" — gör uppsättningen då, återgå inte till rsync.** Bakgrunden: rsync-deployen lät repot tyst driva isär från GitHub, och bump-doktrinen plus `channel: email` (commit 47b96b1, 4 sep) hade aldrig nått maskinen som kör, upptäckt först 5 sep.
- **Minnessynk VPS → Supabase → SCC, byggd 9 sep.** Tabell `agent_memory` (migration `agent_memory_sync`), skript `openclaw-config/scripts/sync_memory.py`, systemd-timer `memory-sync.timer` på VPS:en var 15:e minut, backend-rutt `/api/v1/agent-memory` och panelen i Alex-vyn. Skriptet läser `MEMORY.md` och `memory/YYYY-MM-DD.md` ur arbetskatalogen, hoppar över oförändrade filer på sha256 och markerar försvunna som `deleted_at` i stället för att radera. 29 filer speglade. Verifierat skarpt: en extra rad i dagens minnesfil nådde spegeln vid nästa körning, återställningen likaså, och en körning utan ändringar skrev noll. `--dry-run` visar vad som skulle skrivas. **`routes/alexMemory.ts` är nu död kod och kan rivas.**
  **Båda maskinerna speglar:** VPS:en via `memory-sync.timer`, Macen via launchd-agenten `se.skyland.memory-sync` (plist i `openclaw-config/scripts/`, logg i `~/Library/Logs/memory-sync.log`). De har varsin arbetskatalog med eget minne, så samma `path` finns en gång per host. `/api/v1/agent-memory` dedupliceras därför på path med färskaste `file_mtime` som vinnare — annars hade två långtidsminnen visats, och Macens är äldre. Noteras eftersom det är tredje stället där två maskiner skriver mot samma mål; jämför `com.skyland.daily-ops` längre ned.
- **RÄTTELSE 9 sep, viktig: Alex HAR äkta kontextminne mellan trådar, och det fungerar.** Jag påstod först motsatsen efter att bara ha tittat i `~/.openclaw/memory/` (sqlite). Minnet bor i agentens ARBETSKATALOG, `~/clawd` på både Mac och VPS: `MEMORY.md` (kurerat långtidsminne med ICP, erbjudande, priser, villkor, MEXPAND-spåret) plus `memory/YYYY-MM-DD.md`, 33 filer på VPS:en med den senaste från idag. `agents.defaults.compaction.memoryFlush` skriver dem automatiskt när en session närmar sig tokentaket, och `agents.defaults.memorySearch` indexerar dem med Gemini-embeddings, hybrid vektor 0,7 + text 0,3, källor `memory` och `sessions`. Funktionen är alltså byggd och i drift. **Det som saknas är bara att SCC kan se den**, eftersom backendn kör på Render och filerna ligger på VPS:en.
- ~~**Alex minne visar alltid tomt (9 sep).**~~ **Panelen pekar nu på en källa som finns, men det är INTE agentens minne.** Panelen läser nu `/api/v1/memory/search` och `/api/v1/memory/timeline`, som söker i `activities`, `messages` och `tasks` i Supabase. Den gamla vägen, `/api/v1/alex-memory`, läste `MEMORY.md` och `memory/*.md` ur OpenClaws arbetskatalog, och de filerna finns varken på Render eller på VPS:en, där `~/.openclaw/memory/` bara innehåller sqlite-filer. Rutten `alexMemory.ts` är därmed död kod och kan rivas. **Notera att minnet nu är en annan sak än det ursprungligen var tänkt att vara**: det är vad systemet har sett, inte en kurerad kontextfil.
- **Agenter och MCP i Capabilities (9 sep).** Filtren letade `source === 'subagent'` respektive `'mcp'`, men gatewayns `skills.status` sätter aldrig fältet. `/api/v1/skills-aggregator` gör det rätt — den läser subagentkatalogerna och `mcp_config.json` — men var aldrig inkopplad i frontenden. Nu anropas den och dess träffar slås ihop med gatewayns skills. Den läser filer på maskinen där OpenClaw kör, så på Render svarar den tomt, och då göms flikarna i stället för att visa nollor i evighet. Samma familj som skills-katalogen: filer på operatörens dator finns inte i molnet.
- ~~**Kostnadsöversikten i Alex är en platshållare utan datakälla (9 sep).**~~ **Åtgärdat samma dag.** `CostCenter.tsx` fanns färdigbyggd mot `/api/v1/costs`, som fungerar och har 141 rader data sedan 15 juli. Komponenten importerades bara ingenstans. Platshållaren stod alltså framför en fungerande vy.
- **Leads-vyn visade Cold Experience-broevent som "Okänd besökare" (9 sep).** `event_type='lead'` är en kategori i aktivitetsflödet, inte en lead-tabell, och `ce_activities_bridge` skriver sina livscykelhändelser med samma typ så att de syns under Leads-filtret i loggen. Det är avsiktligt. Men `GET /leads` läste alla sådana rader som lead-intag: 145 av 156 var bro-events, utan `name` på toppnivå och ibland tre rader för samma gäst (skapat, formulär, statusbyte). Kriteriet är nu att raden bär ett eget `source` i details, vilket webbintagen `void_form` och `voice_call` alltid gör och bron aldrig gör. Elva riktiga leads återstår. `?all=1` visar allt för felsökning.
- **~~Alex minne visar alltid tomt (9 sep).~~ Ursprunglig anteckning:** `routes/alexMemory.ts` läser `MEMORY.md` och `memory/*.md` ur `OPENCLAW_WORKSPACE || HOME`. Två fel på en gång: backendn kör på Render där den katalogen inte finns, och på VPS:en där OpenClaw faktiskt kör innehåller `~/.openclaw/memory/` bara `*.sqlite`, ingen markdown, och `MEMORY.md` finns inte alls. Endpointen svarar alltså tomt oavsett maskin. Samma felfamilj som skills-katalogen nedan. Panelen säger nu varför i stället för "Inga minnen ännu", men den riktiga fixen är att läsa minnet ur sqlite-filerna eller över gateway-anslutningen. **Tomt i panelen är inget bevis på att Alex saknar minne.**
- **Agenter och MCP i Capabilities visar alltid 0 (9 sep).** Flikarna filtrerar `skills` på `source === 'subagent'` respektive `'mcp'`, men gatewayns `skills.status` sätter aldrig `source` på något av de 123 objekten. Filtren är alltså korrekta och datat saknar fältet. Antingen fyller gatewayn i `source`, eller så tas flikarna bort. Inte trasigt i frontend.
- **Kostnadsöversikten i Alex är en platshållare utan datakälla (9 sep).** Ingen kod bakom, ingen tabell. Texten säger nu det rakt ut i stället för "kommer snart".
- **`GET /api/v1/skills` läser en katalog som bara finns där OpenClaw kör.** På Render finns den inte, och tom katalog rapporterades som `0`. Dashboarden visade "0 skills" och "Capabilities 0" medan gatewayn hade 73 laddade. Endpointen svarar nu `available:false` med skäl och dashboarden visar `?`. Den riktiga fixen är att läsa skills över gateway-anslutningen som frontend redan har öppen. Samma familj som rollfils-modalen: filer på operatörens dator finns inte i molnet.
- `/api/v1/skills-db` pekar på tabellen `skills` i Supabase. **Den tabellen finns inte.**
- ~~**`ce_*`-schemat är vilande, riv det.**~~ **Överspelat 7 sep.** `ce_leads` och `ce_messages` ÄR nu källan för Cold Experience, och CRM-raderna är en projektion av dem via `ce_mirror_lead`/`ce_mirror_message`. Riv ingenting. Mekaniken står i `~/.openclaw/skills/scc-crm/references/crm-spegling.md` — läs den innan du rör speglingen.
- **Macen kör fortfarande `com.skyland.daily-ops`** i launchd (senast 31 aug 05:05) och skriver in i `openclaw-config/runs/inbox/`. Pollerns plist är avstängd, men inte den här. Två maskiner skriver in i samma katalog.
- ~~**Repots `openclaw.json` är Mac-formad.**~~ **Åtgärdat 8 sep kväll.** Repots `openclaw.json` är nu driftens fil med hemligheter som `{{NYCKEL}}` och hemkatalogen som `{{OPENCLAW_HOME}}`, alltså maskinneutral; renderad med VPS:ens `~/.openclaw/.env` är den byte för byte identisk med live (`deploy_openclaw_config.sh --check`, körs även av preflight kontroll 8 varje morgon). Deploy-skriptet skriver inte längre `cron/jobs.json` utan `--with-cron` (gatewayen hade migrerat in Macens jobb), och dess hårdkodade Mac-sökväg till valideraren är borta. Valideraren har prefixregel i stället för en lista där `ollama/llama3.1:8b` stod som giltig. **Arbetsordning framåt: ändra i repot, `--check` visar diffen, deploya, starta om gatewayen. En handrättning direkt i live ger VARNING i preflight tills den är intagen i repot.**
- ~~Hemsidans boka-knapp länkade till Calendly~~ **åtgärdad**: knappen pekar på `cal.com/joakim-landqvist-yrcioq/15min` (Skyland_AI_System `18dfd61`), verifierad live 1 sep. Sajtens mobilbuggar (röstdemot avklippt, tangentbordsnav, död policylänk) fixade 1 sep i `05a523e` — se det repots logg.
