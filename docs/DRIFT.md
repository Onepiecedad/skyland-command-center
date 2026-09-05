# DRIFT.md — vad som kör just nu

> **Den enda sanningen om driften.** Uppdateras i samma commit som ändrar något.
> Handover-filerna under `docs/HANDOVER_*.md` är historik, inte nuläge.
> Senast verifierad: **2026-09-01** (Claude + Joakim, live-tester mot prod).
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
| Röst på WhatsApp (walkie-talkie) | Röstmeddelande till Alex → transkribering via `POST /api/v1/voice/stt` (ElevenLabs Scribe) → svar som röstmeddelande med sajtens svenska Alex-röst via `POST /api/v1/voice/alex-tts`. Båda Bearer `SCC_API_TOKEN`, definierade före voice-routerns `VOICE_WEBHOOK_TOKEN`-krav. Skillen `walkie-talkie-mode` på VPS anropar dem; ElevenLabs-nyckeln lämnar aldrig Render. Kräver ffmpeg på VPS för ogg/opus-röstbubblor (annars mp3). | SCC + VPS | byggd 1 sep, verifieras efter deploy |
| Mejl ut | Resend, `Skyland AI <joakim@send.skylandai.se>`, DKIM/SPF/DMARC på send.skylandai.se. | Resend (joakim123), eu-west-1 | uppe |
| Mejl in | Resend Inbound (MX på One.com) → `POST /api/v1/webhooks/email/inbound?token=EMAIL_INBOUND_TOKEN`. received → inbox + sekvensstopp + kopia till `EMAIL_FORWARD_TO`; bounced/complained → suppression. **Sedan 31 aug klassas varje matchat svar** (plan 3.1): regler fångar autosvar utan LLM-anrop, resten går till orkestrerarmodellen, och över `REPLY_CLASSIFIER_MIN_CONFIDENCE` flyttas kortet (intresse/fråga → Replied, nej → No Fit) och ett nej spärrar adressen. Klassificeringen är best-effort och kan aldrig fälla inmatningen. | Resend-webhook | uppe, testat 30 aug |
| Bokningar | Cal.com äger bokningen (event type 15 min, `CALCOM_EVENT_TYPE_ID`). Webhook → `/api/v1/webhooks/calcom?token=` → speglas i `bookings`. Kalenderfliken visar dem med detaljkort. | Cal.com + SCC | uppe |
| MarinMekaniker ordernotis | marinmekaniker.nu (Netlify `marin-mekaniker`) → `POST /api/v1/webhooks/marinmekaniker/order?token=` → två mejl via Resend. | SCC | uppe, testat |
| Alex / OpenClaw | **Gateway på VPS sedan 31 aug** (Hetzner CPX22, Helsingfors, 62.238.113.151, användare `alex`, systemd user-units med linger). Poller `~/openclaw-config/scripts/scc_poller.py`. Gatewayn nås över Tailscale på `https://alex.tail8a8e79.ts.net` (tailnet-only, loopback-bunden, inga öppna portar) — Kontoret i SCC pratar med den därifrån. Macens launchd-jobb ligger som `.plist.disabled` — starta dem aldrig igen, två pollers gör dubbelt arbete. Kimi K2.5 orkestrerare (fallback gemini-2.5-flash; claude-sonnet-4-20250514 rensad 31 aug, leverantören avvisar den). Researchern kör Kimi K2.5 sedan 30 aug (fallback DeepSeek V4 Flash) — se 2.3-jämförelsen i HANDOVER_2026-08-30: 10/10 mot 5/10 godkända på första försöket. Övriga underagenter DeepSeek V4 Flash. **WhatsApp** som kanal. | Hetzner CPX22 hel1 | uppe dygnet runt |
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
| `OUTBOUND_ENABLED` | `true` (5 sep) | Motorn skickar på egen hand. Gäller sekvenser med `outbound_policy='outreach'` (default). |
| `OUTREACH_WINDOW_ENABLED` | ej satt (default `true`) | Plan 2.5: LIVE outreach skickas bara vardagar 08–17 (Europe/Stockholm, `OUTREACH_WINDOW_START_HOUR`/`END_HOUR`) och sprids slumpat 1–90 min (`OUTREACH_JITTER_MINUTES`) så en batch inte fyrar i samma tick. Gäller INTE transactional och INTE skuggläget (skuggrader ska synas direkt i Skuggvecka). |
| `TRANSACTIONAL_OUTBOUND_ENABLED` | ej satt (default `true`) | Kill switch för `outbound_policy='transactional'` (Strategisamtal-påminnelserna). Transaktionell post går ut OAVSETT `OUTBOUND_ENABLED`/`OUTBOUND_MODE`/dagsbudget; suppression gäller utom orsaken `existing_customer`. Fynd 4 åtgärdat 30 aug. |
| `OUTBOUND_MODE` | `auto` (5 sep) | Steg med `require_approval: true` går ändå i skugga. Utskick i skugga loggas som `messages.status='shadow'`. Granskas i Försäljning → Skuggvecka; "Skicka nu" skickar manuellt. |
| `SEQUENCE_RUNNER_ENABLED` | `true` | Motorn tickar varje minut. **Verifiera dessa tre innan du enrollar något med `next_run_at=now()`.** |
| `OUTBOUND_DAILY_LIMIT` | `20` (höjt 5 sep från 5) | Tak för riktiga utskick/dag, gäller även "Skicka nu". Nattjobbet skriver in högst 12 öppnare/dygn; resten av taket är utrymme för bump och avslut. Vid 12 utskick/dag når du 50 skickade öppnare på fyra dagar — det är först då copyn går att bedöma. |
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
| **Skyland morgon** | 07:00 | ok, levererad. Slår ihop gamla *Morning check-in* och *Skyland morgonbrief* till en rapport: SCC-siffrorna, vädret, nattens leads-brief om den finns, och alltid en rad även när allt är lugnt |
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

Samma dag städades sju agent-instruktionsfiler (`IDENTITY.md`, `HEARTBEAT.md`) från
`/Users/onepiecedad/...`. **Mönstret att leta efter när något slutar fungera efter en
flytt: en absolut sökväg till den gamla maskinen.** Det har nu förklarat fem separata
fel — pollern, mejlsignalen, kalendern, schemaläggarens `store_key` och kundvakten.

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

| Variabel | Under skuggveckan | För autosend |
|---|---|---|
| `OUTBOUND_MODE` | `shadow` | `auto` |
| `OUTBOUND_ENABLED` | `false` | `true` |
| `OUTBOUND_DAILY_LIMIT` | `5` | `5` tills volymen kräver mer |

Notera att det krävs **två** ändringar, inte en. `OUTBOUND_ENABLED=false` är
huvudströmbrytaren; med den av spelar läget ingen roll. Taket på 5 per dag
räknar sedan 5 sep även manuellt godkända utskick (se avsnittet om
dagsbudgeten) och är alltså ett verkligt tak för första gången.

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

## Kända skavanker

- `backend/src/routes/skills.test.ts`: två tester röda på main (slår mot riktig DB). Inte relaterat till sajt/reaktivering.
- Frontendens `*.test.tsx` saknar jest-dom-typer (tsc rött bara i testfiler; `vite build` grönt).
- Commit `b1cda98` fick med tre lokala ändringar som låg okommittade (`backend/src/index.ts` legacy, `docs/HANDOVER_2026-07-27.md`, `docs/IG_DM_AUTOMATION.md`).
- Integrationshälsan: `n8n:*`-checkarna är borta (2.1b, 30 aug). Nya: `site:skylandai.se`, `site:lang.js` (båda agent-id:na), `site:agent-tools` (självtest över publika adressen med X-Skyland-Key), `elevenlabs:site-agents`. Agent-id:n är hårdkodade i `services/integrationHealth.ts` — byter du agent, byt där + `lang.js` + SITE_FLOWS.
- `GET /api/v1/website/workflows` (Sajt-fliken, "n8n Workflow-hälsa") pekar fortfarande på n8n:s API. Död — visar tomt. Riv eller byt mot `activities` från sajt-webhookarna.
- Engelska röstagenten är otestad i skarpt samtal.
- **VPS:en kan inte hämta från GitHub.** `~/openclaw-config` på Alex har origin över HTTPS utan credentials, så `git pull` felar ("could not read Username"). Skills deployas därför med `rsync` från Macen + `REPO_SKILLS=... scripts/sync_skills.sh <skill>`. Följden: repot på VPS:en driver isär från GitHub, och en fix som ligger committad kan sakna på den maskin som faktiskt kör. Bump-doktrinen och `channel: email` (commit 47b96b1, 4 sep) hade aldrig nått Alex — upptäckt först 5 sep. Ge VPS:en en deploy-nyckel så `git pull` fungerar.
- **`GET /api/v1/skills` läser en katalog som bara finns där OpenClaw kör.** På Render finns den inte, och tom katalog rapporterades som `0`. Dashboarden visade "0 skills" och "Capabilities 0" medan gatewayn hade 73 laddade. Endpointen svarar nu `available:false` med skäl och dashboarden visar `?`. Den riktiga fixen är att läsa skills över gateway-anslutningen som frontend redan har öppen. Samma familj som rollfils-modalen: filer på operatörens dator finns inte i molnet.
- `/api/v1/skills-db` pekar på tabellen `skills` i Supabase. **Den tabellen finns inte.**
- **Macen kör fortfarande `com.skyland.daily-ops`** i launchd (senast 31 aug 05:05) och skriver in i `openclaw-config/runs/inbox/`. Pollerns plist är avstängd, men inte den här. Två maskiner skriver in i samma katalog.
- **Repots `openclaw.json` är Mac-formad.** En körning av `deploy_openclaw_config.sh` skulle sätta `gateway.tailscale.mode=off` och peka arbetsytan på `/Users/onepiecedad/clawd`. Kör det inte förrän configen är VPS-formad.
- ~~Hemsidans boka-knapp länkade till Calendly~~ **åtgärdad**: knappen pekar på `cal.com/joakim-landqvist-yrcioq/15min` (Skyland_AI_System `18dfd61`), verifierad live 1 sep. Sajtens mobilbuggar (röstdemot avklippt, tangentbordsnav, död policylänk) fixade 1 sep i `05a523e` — se det repots logg.
