# Från GoHighLevel till SCC — migrationsplan

> Mål: få in GHL AAC-snapshotens funktioner i SCC så att Joakim kan jobba fullt ut i
> SCC och helt slippa GoHighLevel. Skriven 2026-07-15.

## Vad GHL ger vs vad SCC redan har

| GHL-funktion | SCC-status | Gap |
|--------------|-----------|-----|
| Kontakter + custom fields + tags | ✅ `contacts` (jsonb custom + tags) | — |
| Pipelines + stages + opportunities (kanban) | ✅ `pipelines/stages/opportunities` | — |
| Unified inbox / conversations | ✅ (F1) men få kanaler | Inkommande mejl + SMS in |
| Utgående e-post | ✅ Resend (kill switch + dagsbudget) | — |
| Aktivitets-/audit-logg | ✅ `activities` | — |
| Schemaläggning | ✅ OpenClaw-cron + n8n Cloud | — |
| IG DM-autosvar | ✅ n8n `ig-dm-autosvar` | — |
| **Workflow-/sekvensmotor** (steg, väntetider, triggers, grenar) | ❌ finns inte (`automations.ts` = bara läs-vy av cron) | **Största gapet** |
| **Inkommande mejl + svarsdetektering** | ❌ | Bygg |
| **SMS (+ ev. samtal)** | ❌ | Bygg (SCC-31 planerad) |
| **Kalender/bokning fullt kopplad** | 🟡 Cal.com finns i `voice.ts`, env ej satt | Webhook + påminnelser + no-show |
| Formulär / funnels / landningssida | ✅ utanför GHL (Netlify + studios.skylandai.se) | Netlify-form → intake |
| Rapportering | 🟡 delvis | Utöka vid behov |

**Slutsats:** SCC har redan hela CRM-kärnan. För att helt ersätta GHL behöver fem saker
byggas: (1) en sekvensmotor, (2) inkommande mejl, (3) SMS, (4) Cal.com fullt kopplad,
(5) tvåvägs-konversationer i inboxen. Ingen big-bang-omskrivning — det är fem avgränsade bitar.

## Den avgörande arkitekturfrågan: sekvensmotorn

GHL:s hjärta är workflow-byggaren (skicka mejl → vänta 2 dagar → om svar, stoppa →
annars mejl 2 → …). SCC saknar detta. Två vägar:

**A. n8n som motor (snabbast, du har det redan).** SCC äger datan och exponerar
API + webhooks; n8n kör sekvenserna (väntetider, grenar, triggers) och anropar SCC:s API
och e-post/SMS-leverantörerna. Fördel: visuell byggare, snabbt igång, återanvänder
IG-DM-infran. Nackdel: logiken bor delvis i n8n Cloud (beroende + kostnad), inte "helt i SCC".

**B. Native sekvensmotor i SCC (full ägo).** Bygg en enkel motor: `sequences` +
`enrollments` + `steps` (typ: send_email / send_sms / wait / branch / move_stage / tag),
driven av en scheduler-tick. Fördel: allt i ett system, du äger det fullt ut — precis din
vision. Nackdel: mer bygge (men rakt fram, inte magi).

**C. Hybrid (rekommenderad startpunkt).** Bygg en *lätt* native sekvensmodell i SCC för de
tre kärnflödena (cold email-drip, strategisamtal-påminnelser, kick-off) och använd n8n bara
för udda kantfall. Ger snabb nytta nu och äganderätt över tid.

## Fasplan (inkrementell — GHL kan stängas av först i sista fasen)

**Fas 1 — Grund för automation**
- SCC-events + utgående webhooks (contact skapad, stage ändrad, svar inkommet, bokning gjord).
- Cal.com fullt kopplad: sätt `CALCOM_*`-env + webhook → bokning skapar/uppdaterar opportunity
  + activity i SCC.
- Netlify-form (studios.skylandai.se) → SCC-intake (källa `web_form`).
→ Nu bor all bokning + formulärdata i SCC.

**Fas 2 — Kanaler (tvåvägs)**
- Inkommande mejl (Resend inbound / mailbox-webhook) → matcha kontakt → logga i unified inbox
  → emit "reply"-event (stoppar drip).
- SMS: leverantör (46elks för SE, eller Twilio) → `comms:sms`-executor + inkommande SMS-webhook.
→ Nu är e-post, SMS och IG DM tvåvägs i samma inbox.

**Fas 3 — Sekvensmotorn (kärnan)**
- Bygg de tre GHL-flödena, triggade av SCC-events, agerande via SCC:s API:
  - **Cold email-drip**: mejl 1 → vänta → mejl 2 → … tills svar (kursens "följ upp tills de svarar").
  - **Strategisamtal**: bokningsbekräftelse → påminnelser (24h/1h) → no-show → om-boknings-uppföljning.
  - **Kick-off**: bekräftelse + påminnelser + välkomstsekvens.
- Startpunkt n8n (väg A/C), migreras native (väg B) när det stabiliserat sig.

**Fas 4 — Native + cutover**
- (Vid väg B/C) bygg native `sequences`/`enrollments` i SCC, migrera flödena dit.
- Pipelines finns redan konceptuellt i SCC (MEXPAND/Strategisamtal/Kick-Off). Spegla stegen.
- Stäng av GHL.

## Ärlig avvägning (läs innan beslut)

GHL ger allt detta **idag** för en månadsavgift. Att bygga det i SCC = några veckors fokuserat
arbete, men ger full ägo, ingen per-seat-kostnad, och löser "två parallella system"-problemet
genom att samla allt på ditt eget bygge.

Men: **det snabbaste till första betalande kund är att köra ETT system nu — inte att bygga
klart SCC först.** Rekommendation: kör din nuvarande outreach (IG-DM + mejl + Cal.com) för att
landa första kunden, och bygg SCC-ersättningen fas för fas parallellt. Låt intäkten, inte
bygget, styra takten. Big-bang-ersättning av GHL innan du har en kund är fel prioritering —
hur kul det än är att bygga.

## Nästa beslut (dina)
1. Sekvensmotor: **n8n-först (snabbt)**, **native (ägo)**, eller **hybrid (rekommenderad)**?
2. SMS-leverantör: 46elks (SE) eller Twilio?
3. Timing: bygga nu, eller efter första kunden?
