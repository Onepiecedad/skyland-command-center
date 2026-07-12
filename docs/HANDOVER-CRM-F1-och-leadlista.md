# Handover — F1 CRM-kärna + lead-lista / GHL-strategi

> Datum: 2026-07-12
> Operatör: Joakim (joakim@skylandai.se)
> Omfattning: sammanfattning av en arbetstråd som (1) levererade F1 CRM-kärnan i
> Skyland Command Center (SCC), (2) kartlade affärsmodellen från AI Agency Course,
> och (3) påbörjade en ICP-lead-lista. Läs detta först vid nästa session.

---

## 1. Bakgrund och mål

Joakim går en kurs ("AI Agency Course", Malte) som bygger en lead-gen-byrå för
lokala tjänsteföretag och levererar via GoHighLevel (GHL). Joakim vill använda GHL
i början (14 dagars gratis trial) men på sikt köra allt i sitt eget system — SCC med
AI-agenten **Alex** — istället för GHL.

Strategisk slutsats (från GHL-analysdokumentet + denna tråd): **bygg inte en GHL-klon.**
Bygg det tunna, AI-drivna exekveringslagret ovanpå SCC:s befintliga kärna. GHL:s värde
är CRM + pipeline + inbox + kanaler + bokning; SCC:s styrka är AI-orkestrering. F1 gav
SCC den CRM-kärna som var det största gapet.

---

## 2. Vad som byggdes och levererades (F1 CRM-kärnan)

Allt committat på `main` i `skyland-command-center` (INTE pushat än — se §8).

Commits:
- `b1a18f4` — `feat(crm): F1 core` (16 filer)
- `bbfe8c9` — `docs(claude): fix stale Supabase ref + RLS-skuld + F1-leverans`

Tickets (se `docs/TICKETS_F1_CRM.md`):
- **SCC-22** contacts-tabell + backfill från lead-activities.
- **SCC-23** lead-intake upsertar en normaliserad contact (`services/contacts.ts`),
  enhetstestad (`services/contacts.test.ts`, 9 tester gröna). Ny `routes/contacts.ts`.
- **SCC-24** pipelines/stages/opportunities + seedad default-pipeline "Sales".
  Ny `routes/pipelines.ts` (board, skapa, move-stage med activity-logg).
- **SCC-25/26** frontend: `PipelineBoard.tsx` (drag-kanban), `ConversationInbox.tsx`
  (tråd per kontakt över kanaler), `CrmView.tsx`, ny CRM-flik i `App.tsx`.
- **SCC-27** Alex-verktyg i `llm/tools.ts`: `get_contact`, `list_contacts`,
  `move_opportunity`, `log_interaction`.
- `customer_status`-vyn utökad med `contacts_count` + `open_opportunities` (additivt,
  statuslogiken orörd).

Verifiering: backend + frontend `tsc --noEmit` = exit 0. `vitest` = 9/9 gröna.

---

## 3. Databasläget (kört skarpt)

Rätt Supabase-projekt: **`skyland-command-center`, ref `wfwqjxsuvbacvcmpiesl`**
(`https://wfwqjxsuvbacvcmpiesl.supabase.co`). Den gamla ref:en `sahrizknasraftvqbaor`
i CLAUDE.md var inaktuell och är nu rättad.

Migrationer applicerade via Supabase-MCP:
- `ticket22_contacts` — contacts-tabell + index. 5 leads backfillade → 5 contacts.
- `ticket24_pipelines` — pipelines/stages/opportunities. Default-pipeline "Sales" med
  6 stages: New → Contacted → Qualified → Proposal → Won → Lost.
- `ticket22_24_customer_status_crm` — uppdaterad vy.

Verifierat: contacts=5, default_pipelines=1, stages=6, opportunities=0. Alla tre kunder
(thomas/axel/gustav) fortsatt status `active`.

---

## 4. Affärsmodellen (från kursen, nu fullt kartlagd)

Källa: `ai-agency-course-extract/` (hela kursen OCR:ad + GHL-analysdokument).

- **Ersättning:** ren provision, **15–20% av totala försäljningsbeloppet inkl. moms**.
  Ex: paket 10 000 kr → 1 500 kr till Joakim, 8 500 kr till studion. Kursen rekommenderar
  att starta på provision (Joakim sköter closingen själv).
- **Leveransmotorn (MEXPAND):** FB/IG-annons → Facebook Lead Form (namn/telefon/mail)
  → GHL skickar personligt SMS 5–10 min efter signup → följer upp tills svar → notis till
  säljaren → Joakim ringer och bokar sittning → återbokningsloop efter besök (en kund värd
  10–15 bokningar över tid).
- **Joakims nisch (ny ICP):** tatuerare + liknande höga-ticket lokala (PMU, estetik,
  barber/frisör, hudvård). Geo: Mölndal + Göteborg först, sedan rikstäckande. Passar
  modellen: hög ticket (15% blir riktiga pengar) + tomma stolar att fylla.

### VIKTIG distinktion — två separata pipelines
1. **Joakims prospekterings-pipeline:** skrapa studior → ringa/maila/DM:a → boka säljmöte
   → skriv på. *Lead-listan vi bygger matar denna.* Behöver INTE GHL:s SMS-motor.
2. **Kundens leverans-pipeline (MEXPAND):** FB-lead → SMS → samtal → bokad sittning →
   återbokning. Detta är per kund/studio.

Blanda inte ihop dem.

---

## 5. Lead-listan / ICP (påbörjad, ej klar)

Uppgift = kursens moment 3.4 "Skrapa Leads". Parametrar (bekräftade av Joakim):
- Nisch: tatuerare + liknande (PMU, estetik, barber, hudvård).
- Geo: Mölndal + Göteborg först.
- Storlek: ~100.
- Outreach är **multikanal** (cold call + mail + IG/FB DM) → varje lead behöver
  **studio-namn, ägare, telefon, mail, Instagram/Facebook, webb, nisch** — inte bara telefon.

### Datakälla — slutsats
- **Explorium ("Vibe Prospecting", MCP `193f09b8…`) är fel verktyg.** Fri koll visade
  ingen "tatuerar"-kategori (bara generiska föräldrar som cosmetics/arts & crafts); det är
  en B2B/LinkedIn-databas där svenska mikrostudior knappt finns. Drar krediter (5/urvalstabell
  + per rad vid export) — spendera inga krediter här.
- **Registret saknar ren Google Maps/Places-koppling** (Local Falcon = SEO-rank, Thumbtack = USA).
- **Rätt källa = Google Maps / Google Business** (namn/telefon/webb/omdömen per studio),
  berikad med mail + IG från deras sajt/sociala. Nås via Chrome-tillägget (Browser 1, macOS,
  var kopplat).

### Öppet beslut (ställt, ej besvarat pga avbrott)
- **Var ska listan landa?** Joakims följdfråga: *kan den landa i BÅDA* (SCC contacts + GHL)?
  → Ja, tekniskt görbart: upserta till SCC `contacts` OCH till GHL via LeadConnector-MCP.
- Vilka kanaler körs (styr hur hårt varje lead berikas).

---

## 6. GHL-läget (från Joakims Codex-arbete)

Joakim har ett skarpt GHL sub-account:
- Name: **Skyland AI System**, Location ID `QXB9Atyp12wDXZRMboPJ`,
  Company ID `YobrcWc7ttgXBexQFij3`, SE/Europe/Stockholm, skylandai.se.
- Innehåll idag: bara demodata (generisk "Marketing Pipeline", 5 exempelkontakter,
  4 exempeldeals, 0 custom fields, tomt snapshotId). I praktiken tomt.

MCP-status:
- **LeadConnector MCP fungerar** för CRM: läsa location, pipelines/stages, custom fields,
  kontakter; skapa/upserta/uppdatera kontakter; tags; söka/uppdatera opportunities
  (stage/status/value/name/assigned).
- **HighLevel generic MCP är trasig** — `HTTP 401: this authClass type is not allowed to
  access this scope` (IAM/scope-problem).
- **Kan INTE via MCP:** skapa pipelines/stages, skapa custom fields, skapa workflows/automations,
  koppla Meta Lead Forms, konfigurera SMS/telefonnummer, konfigurera kalendrar, läsa/applicera
  snapshots, ändra white-label/agency/SaaS-inställningar. Dessa kräver GHL:s UI eller bredare
  API-scope.

### Joakims fråga: "kan du göra inställningar/ändringar i mitt GHL så jag slipper det manuella?"
Ärligt svar att hantera nästa session:
- **Ja, delvis** — det som LeadConnector-MCP:t exponerar (kontakter, tags, opportunities,
  stage-flyttar, importera lead-listan som kontakter, skapa/validera testdata).
- **Nej, inte** pipelines/custom fields/workflows/kalender/Meta-koppling/snapshots via
  nuvarande scope — de är GHL:s admin-lager och måste göras i UI:t eller med utökad OAuth-scope
  (troligen fix på den trasiga generic-MCP:ns auth). Alternativ: Claude-in-Chrome kan klicka i
  GHL-UI:t om vi vill automatisera det manuella — men det är bräckligt och bör bekräftas per steg.
- OBS: LeadConnector-MCP:t var kopplat i Joakims Codex-session, **inte i denna tråds toolset**.
  Nästa session måste verifiera att GHL-MCP:t är anslutet här innan den kan operera kontot.

---

## 7. Rekommenderad väg framåt (oförändrad, nu skärpt)

1. **F2 — stäng loopen** så SCC kan agera utåt: utgående mail (egen domän, korrekt
   SPF/DKIM/DMARC), SMS via 46elks, kalender/bokning kopplad till röst-AI. Detta gör dig
   oberoende av GHL i egen drift och är dessutom själva produkten (bokade sittningar).
2. **Bevisa på en riktig kund** helt på SCC, utan GHL.
3. **Säkra grunden** innan externa kunder: RLS + policies, riktig användarauth, fixa
   frontend-token-läckan.
4. **F4 — produktifiera** (snapshots, per-kund-branding, Stripe-rebilling) sist.

Lead-listan (ovan) är parallellt spår ett: den matar prospekteringen som ger första intäkten.

---

## 8. Kända risker / måsten

- **Push saknas.** Två commits ligger lokalt på `main`, ej pushade (sandboxen saknar
  GitHub-auth). Joakim kör `git push origin main` från sin maskin.
- **Git-lås-egenhet:** den mountade `.git` tillåter `rename` men inte `unlink`, så git lämnar
  kvar `HEAD.lock`/`index.lock`. Flytta undan dem (`mv lock lock.old`) mellan git-operationer.
- **RLS avstängt** på alla kärntabeller inkl. nya `contacts` — OK internt bakom Bearer-token,
  MÅSTE stängas före extern kunddata (F4). Aktivera inte RLS utan policies.
- **Frontend-token-läcka:** `VITE_SCC_API_TOKEN` + `VITE_GATEWAY_TOKEN` i bundlen. Måste bort
  före multi-tenant.
- **Explorium-krediter:** spendera inga där för lokala SE-studior — fel källa.

---

## 9. Nyckel-referenser

| Sak | Värde |
|-----|-------|
| SCC Supabase-projekt | `skyland-command-center` / `wfwqjxsuvbacvcmpiesl` |
| GHL sub-account | Skyland AI System / Location `QXB9Atyp12wDXZRMboPJ` / Company `YobrcWc7ttgXBexQFij3` |
| Repo | `github.com/Onepiecedad/skyland-command-center` (branch `main`) |
| F1-tickets | `docs/TICKETS_F1_CRM.md` |
| Kursmaterial | `ai-agency-course-extract/` (OCR + GHL-analys + handlingsplan) |
| Datakälla-slutsats | Google Maps (rätt) · Explorium (fel) |

---

## 10. Direkta nästa steg för nästa session

1. Svara på Joakims öppna beslut: landa lead-listan i **både** SCC contacts och GHL? (ja, görbart).
2. Verifiera om GHL LeadConnector-MCP är anslutet i denna kontext.
3. Bygg ~100-listan (tatuerare + liknande, Mölndal+Göteborg) via Google Maps/Chrome, berika
   mail + IG, leverera som CSV + upserta till SCC contacts (+ ev. GHL).
4. Bekräfta med Joakim vilka outreach-kanaler han kör (styr berikningsdjup).
5. När han är redo: skriv F2-tickets på samma sätt som F1.
