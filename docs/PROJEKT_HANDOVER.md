# Skyland — Projektövergripande handover

> Uppdaterad: 2026-07-14 · Operatör: Joakim (joakim@skylandai.se)
> Detta är helhetsbilden: affären, systemet, vad som är byggt, exakt nuläge, plan och slutmål.
> Sessionsspecifika detaljer: `HANDOVER_2026-07-12/13/14.md`. Teknisk agentbriefing: `CLAUDE.md`.

---

## 1. Vad vi bygger och varför (slutmålet)

Joakim driver **Skyland AI** — en AI-byrå vars affär är att **fylla stolar hos lokala
tjänsteföretag** (först: tatuerare i Göteborg/Mölndal) mot ren provision (15–20 % av
försäljningsvärdet inkl. moms). Modellen kommer från AI Agency Course (Malte) och levereras
klassiskt via GoHighLevel — men Joakims slutmål är att **äga hela stacken själv**:

**Skyland Command Center (SCC)** — ett eget AI-drivet operativsystem där agenten **Alex**
(Master Brain) sköter CRM, prospektering, outreach, uppföljning, bokning och rapportering,
med Joakim som godkännande operatör. GHL används som tillfällig brygga (14-dagars trial för
kund #1), inte som slutstation. Strategin är uttryckligen: **bygg inte en GHL-klon** — bygg
det tunna AI-exekveringslagret ovanpå SCC:s kärna. CRM-datan är det enda GHL aldrig ger
tillbaka; därför byggdes den först (F1).

**Slutbilden (F4, "produkten"):** white-label-instanser av SCC per kund, egen användarauth,
RLS på datan, per-kund-branding, Stripe-rebilling, Meta Lead Ads → SMS inom 5 min → bokade
sittningar → återbokningsloop — helt utan GHL. Kundens dashboard är en försäljningsyta;
Joakims dashboard är kontrollrummet.

## 2. Affärsmodellen i drift

- **Två separata pipelines — blanda aldrig ihop dem:**
  1. **Joakims prospektering** (agency-nivå, `customer_id=null`): skrapa studior → scora →
     DM/ring → boka säljmöte → signa. Pipeline "Prospecting (Agency)", 8 stages.
  2. **Kundleverans (MEXPAND)** (per kund): FB/IG-annons → Lead Form → SMS inom 5–10 min →
     uppföljning tills svar → Joakim ringer → bokad sittning → återbokningsloop.
- **ICP:** tatuerare + likartade high-ticket lokala (PMU, estetik, barber). Geo: Gbg/Mölndal
  först, sedan rikstäckande.
- **Kunder idag (interna instanser):** Thomas (MarinMekaniker), Axel (Hasselblads Livs),
  Gustav (Cold Experience). Första betalande byrå-kunden: inte signad än — det är
  prospekterings-spårets uppgift.

## 3. Systemet — arkitektur & drift (NULÄGE 2026-07-14)

| Del | Var | Status |
|-----|-----|--------|
| Backend (Express/TS) + SPA | **Render**, tjänst `scc`, Frankfurt, Starter, Docker | **LIVE** på `https://scc.skylandai.se` (TLS, health checks, auto-deploy vid push) |
| Databas | Supabase `skyland-command-center` / `wfwqjxsuvbacvcmpiesl` | Live. RLS AV (medveten skuld) |
| Lead-intake | Hemsida (skyland-ai-os.netlify.app) → **n8n Cloud** (`onepiecedad.app.n8n.cloud`) → `/api/v1/leads/intake` | **LIVE**, verifierad med test-lead. ngrok AVVECKLAD |
| Utgående e-post | Resend (konto **joakim123/gmail** pga free tier), domän `send.skylandai.se` | **VERIFIERAD + FÖRSTA MAILET SKICKAT** genom approve-flödet. `OUTBOUND_ENABLED=true`, budget 5/dag |
| Dashboard (operatör) | Lokal vite dev (`localhost:5173`, LaunchAgent `ai.skyland.scc-frontend`) mot prod-API | Fungerar. SPA:n som Render serverar saknar medvetet tokens (se §6) |
| Alex/LLM | OpenRouter (gpt-4o default) | Live, fullt CRM-verktygslager |
| Sub-agenter (OpenClaw) + röst-gateway | Joakims Mac (`127.0.0.1:18789`) | Fungerar ENDAST när Macen är på — claw-tasks från molnet når inte hit ännu |
| GHL | Sub-account "Skyland AI System" (`QXB9Atyp12wDXZRMboPJ`) | I praktiken tomt; LeadConnector-MCP funkar för data, inte struktur. Trial för kund #1 |
| Lokala LaunchAgents | ngrok + scc-backend **AVSTÄNGDA** (`.disabled`), scc-frontend PÅ | — |

## 4. Vad som är byggt (per fas)

**v1 MVP (tickets 1–21):** REST-API (~36 routes), task-system med SUGGEST→approve→dispatch,
dispatcher (local/n8n/claw + rate limits), Master Brain-chat med tool calling, 3D-dashboard,
activities/audit, customer_status-vy, LLM-adapterlager (OpenAI/DeepSeek/OpenRouter).

**F1 — CRM-kärnan (SCC-22–27, 2026-07-12):** contacts/pipelines/stages/opportunities,
lead-intake upsertar contacts (idempotent dedupe_key), kanban (PipelineBoard), unified inbox
per kontakt, Alex-verktyg för CRM-läsning/flytt.

**Prospekterings-spåret (2026-07-13):** 37 tatuerarstudior skrapade/berikade/scorade
(volym/kvalitet/bokningsflöde-modell) i pipeline "Prospecting (Agency)". Booking-flow
VERIFIERAD per sajt → tier-korrigeringar (TELLO 83/B, Unikum 78/B, Ink Brothers 57/C —
har redan onlinebokning). **Tier A = Rita Simonn 95, Crazy Colour 93, Skindiver 87,
Ivory Tower 87.** DM-öppningsrader med verifierade hooks + källor:
`ai-agency-course-extract/dm-rader-tier-a-batch1.md` + `contacts.custom.dm_hook`.
**INTE utskickade än.**

**Alex-uppgradering (2026-07-13/14):** `get_contact` (alla fält + pipeline-läge),
`list_contacts` (tier-filter, score-sort), `list_opportunities` (pipeline/stage-filter),
`update_contact` (whitelistade fält, custom-merge, activity-logg). CRM-korten visar
score/IG/adress(Maps)/bokningsflöde med sort/filter.

**F2 påbörjad (SCC-28/29/30, 2026-07-14):** Render-deploy (körbok: `RENDER_DEPLOY.md`),
e-postinfra (Resend + SPF/DKIM/DMARC på `send.skylandai.se`, körbok: `EMAIL_INFRA.md`),
outbound-modellen (messages: status + provider_message_id), Resend-adapter
(`services/email.ts`), `comms:email`-executor med kill switch + dagsbudget
(`services/comms.ts`). **Verifierat end-to-end:** task → Joakim godkände → dispatch →
mail levererat från send.skylandai.se.

## 5. Plan framåt (prioriterad)

**Omedelbart (intäktsspåret — viktigast):**
1. **Skicka DM-raderna till tier A** (4 studior, manuellt via IG — Joakims hand). Flytta korten
   till Contacted + logga via Alex. Detta är vägen till första betalande kunden.
2. Kund #1 på GHL-trialen när möte bokats (kursens flöde, noll bygge).

**F2 färdigt (tickets: `TICKETS_F2_COMMS.md`):**
3. SCC-31 SMS via 46elks (virtuellt nummer, tvåvägs) — kärnan i MEXPAND-leveransen.
4. SCC-32 inbound webhooks (mail/SMS-svar → unified inbox, Resend delivered/bounce-status).
5. SCC-33 kalender via Cal.com (`CALCOM_*` finns redan i config) + koppling till röst-AI.
6. SCC-34 Alex-verktyg `send_email`/`send_sms` (skapar ALLTID SUGGEST-task) + `book_meeting`.
7. SCC-35 säkerhet före volym: leverantörssignaturer på webhooks, auth på voice-routen,
   separata tokens för comms.
8. **UI-lucka (upptäckt 14/7):** approval-vyn finns bara på kundsidor — agency-tasks
   (`customer_id=null`) syns INTE i dashboarden. Mounta ApprovalQueue/PendingApprovals
   globalt (System-fliken). Blockerar bekväm outreach-godkänning.

**F3 — Alex som operatör (visionen från 13/7-diskussionen):**
9. Research-flöde: Alex → task (`claw:research`) → approve → sub-agent → rapport i **arkiv**
   (`documents`-tabell saknas — bygg) → berika kort via update_contact-mönstret.
10. List-bygge: "alla tatuerare i Luleå" → sub-agent med **Google Places API** (inte skrapning)
    → contacts + opportunities. Dedupe-mönstret finns.
11. Stale-motor (opportunity utan aktivitet X dagar → task/notis), `enriched_at`,
    kostnadslogg per sub-agent-körning.
12. Sub-agenter måste bli molnnåbara (OpenClaw kör på Macen — exponera säkert eller flytta).

**F4 — produktifiera:** riktig användarauth + RLS med policies (HÅRT KRAV före extern
kunddata), white-label per kund, Meta-integration direkt (Lead Ads webhook, business-
verifiering — STARTA TIDIGT, lång ledtid), Resend Pro-konsolidering (en domän per kund),
Stripe-rebilling, cutover från GHL = CSV-import (spegla stages/fält från start).

## 6. Kända skulder & fallgropar (läs innan du rör något)

1. **RLS AV på alla tabeller.** OK internt bakom Bearer-token. Aktivera ALDRIG utan policies.
2. **Tokens i frontend:** `VITE_SCC_API_TOKEN`/`VITE_GATEWAY_TOKEN` = publika. Render-SPA:n
   byggs medvetet UTAN dem (konsolfel på scc.skylandai.se är väntade) — dashboard körs lokalt
   tills riktig auth finns. Baka INTE in tokens i publik bundle igen.
3. **Supabase realtime timar ut från Render** (skills/system_events) — bara live-uppdateringar
   påverkas. Olöst, låg prio.
4. **Outbound är skarpt:** `OUTBOUND_ENABLED=true`, budget 5/dag. Varje utskick = mail i
   Joakims namn. SUGGEST-flödet är skyddet — inga undantag, aldrig direktutskick från verktyg.
5. **Två separata Resend-konton:** skylandai-workspacet (marinmekaniker) och joakim123/gmail
   (send.skylandai.se + `RESEND_API_KEY`). Konsolidera till Pro vid F4.
6. **Explorium-krediter:** fel källa för svenska mikroföretag — spendera inget där.
7. **Git i mountad miljö:** `.git` tillåter inte unlink → flytta `*.lock` med `mv`. Push från
   Joakims terminal. Auto-deploy triggas av varje push.
8. **prospects-tabellen** (n8n skriver dit) ≠ **contacts** (CRM-entiteten). Intaket upsertar
   contacts; activities är audit. Källa för CRM-frågor = contacts.
9. Externa MCP:er (Supabase, GHL, Chrome) ansluts per session — verifiera före operation.

## 7. Nyckelreferenser

| Vad | Värde |
|-----|-------|
| Prod-URL | `https://scc.skylandai.se` (Render `srv-d9av0n1kh4rs73c6mrtg`, Frankfurt) |
| Repo | `github.com/Onepiecedad/skyland-command-center` (main, auto-deploy) |
| Supabase | `wfwqjxsuvbacvcmpiesl` |
| n8n | n8n Cloud `onepiecedad.app.n8n.cloud` (API-nyckel i backend/.env) |
| Resend | konto joakim123 · domän `send.skylandai.se` · avsändare `Skyland AI <joakim@send.skylandai.se>` |
| GHL | Location `QXB9Atyp12wDXZRMboPJ` / Company `YobrcWc7ttgXBexQFij3` |
| Prospecting-pipeline | `pipelines.id = 2f3e8859-6294-42a0-9cd7-f712155091e9` |
| DNS | one.com (skylandai.se) |
| Kursmaterial/affärsmodell | `~/ai-agency-course-extract/` |
| Ticketdokument | `TICKETS_F1_CRM.md` · `TICKETS_F2_COMMS.md` |
| Körböcker | `RENDER_DEPLOY.md` · `EMAIL_INFRA.md` |

## 8. Ett stycke till nästa session

Systemet är i produktion och kan ta emot leads och skicka godkänd e-post. Den enskilt
viktigaste nästa handlingen är inte teknisk: **skicka de fyra tier A-DM:en och boka första
säljmötet.** Tekniskt är nästa bygge SMS (SCC-31) + approval-vyn för agency-tasks, därefter
inbound-svar och kalender. Allt kund-påverkande går genom SUGGEST → Joakims godkännande —
det är systemets ryggrad och får aldrig kringgås, hur smidigt det än vore.
