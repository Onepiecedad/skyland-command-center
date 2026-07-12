# F1 — CRM-kärnan (v2.0) — Tickets

> Parallellspår medan GHL används på 14-dagars trial för första kunden.
> Mål: ge SCC en ägd contact-, pipeline- och konversationsmodell så att leads blir
> hanterbara entiteter — inte loggrader. Detta är den enda delen GHL **inte** ger dig
> tillbaka när du lämnar plattformen, och den låser upp allt annat (F2–F4).
>
> Konventioner: routes under `backend/src/routes/`, migrations under
> `database/migrations/` (`CREATE TABLE IF NOT EXISTS`, `ticketNN_*.sql`), Master
> Brain-verktyg i `backend/src/llm/tools.ts`, commit-stil `feat(scope): beskrivning`.
> Alla kund-påverkande actions följer AGENT_POLICY (SUGGEST som standard).

## Beroendekarta

```
SCC-22 (contacts)  ──►  SCC-23 (intake→contacts) ──►  SCC-26 (inbox)
     │                        │
     │                        └──►  SCC-27 (CRM-verktyg)
     └──►  SCC-24 (pipelines) ──►  SCC-25 (kanban)
```

SCC-22 är kritisk väg och blockerar allt. Testerna skrivs **före** SCC-23 rör
lead-flödet i produktion.

---

## SCC-22 — Contacts-datamodell

**Fas:** F1 · **Prio:** P0 · **Blockerar:** allt

Normaliserad kontaktentitet så leads slutar leva som `activities`-rader.

**Filer**
- `database/migrations/ticket22_contacts.sql` (ny)

**Innehåll**
- Tabell `contacts`: `id, customer_id, name, email, phone, company, website, tags[], custom jsonb, status, source, dedupe_key, created_at, updated_at`.
- `status` CHECK: `new | working | qualified | won | lost`.
- Unik `dedupe_key` (samma nyckel som leads.ts redan beräknar) för idempotent upsert.
- Index på `customer_id`, `email`, `status`, `dedupe_key`.
- Backfill: skapa contacts från befintliga `activities` med `event_type='lead'`.

**Klart när**
- Migration kör rent mot en tom DB och mot en DB med befintliga lead-activities.
- Ingen befintlig tabell ändras destruktivt.

---

## SCC-23 — Lead-intake → contacts

**Fas:** F1 · **Prio:** P0 · **Kräver:** SCC-22 + tester

Intake upsertar en contact i stället för att bara logga en activity. Activity-loggen
behålls som event (audit).

**Filer**
- `backend/src/services/contacts.ts` (ny) — rena mappnings-/upsert-helpers.
- `backend/src/services/contacts.test.ts` (ny) — enhetstester, inga DB-anrop.
- `backend/src/routes/leads.ts` (ändra) — anropa `upsertContactFromLead` i `POST /intake`.
- `backend/src/routes/contacts.ts` (ny) — `GET /`, `GET /:id`, `PATCH /:id`.
- `backend/src/server.ts` (ändra) — mounta `/api/v1/contacts`.

**Klart när**
- En inkommande lead skapar/uppdaterar exakt en contact (idempotent på `dedupe_key`).
- Activity-loggen finns kvar oförändrad.
- `contacts.test.ts` grön.

---

## SCC-24 — Pipelines & opportunities

**Fas:** F1 · **Prio:** P0 · **Kräver:** SCC-22 · **Blockerar:** SCC-25

Deal-/stage-modell så kontakter kan flyttas genom en säljtratt.

**Filer**
- `database/migrations/ticket24_pipelines.sql` (ny)
- `backend/src/routes/pipelines.ts` (ny)
- `backend/src/server.ts` (ändra) — mounta `/api/v1/pipelines`.

**Innehåll**
- Tabeller `pipelines`, `stages` (ordnade per pipeline), `opportunities` (kopplade till contact + stage).
- Seed: en default-pipeline med stages `New → Contacted → Qualified → Proposal → Won/Lost`.
- Route: CRUD på pipelines/opportunities + `POST /opportunities/:id/move` (byt stage, loggar activity).

**Klart när**
- Default-pipeline finns efter migration.
- Move-stage uppdaterar opportunity och skriver en activity.

---

## SCC-25 — Kanban-vy (frontend)

**Fas:** F1 · **Prio:** P1 · **Kräver:** SCC-24

**Filer**
- `frontend/src/api.ts` (ändra) — pipeline-/opportunity-metoder + typer.
- `frontend/src/components/PipelineBoard.tsx` (ny) — drag-bara kort.
- `frontend/src/App.tsx` (ändra) — ny vy.

**Klart när**
- Kolumner per stage, kort per opportunity, drag flyttar kort och persist:ar via API.
- Följer glassmorphism-temat.

---

## SCC-26 — Unified inbox (frontend + aggregat)

**Fas:** F1 · **Prio:** P0 · **Kräver:** SCC-23

**Filer**
- `backend/src/routes/contacts.ts` (ändra) — `GET /:id/conversation` aggregerar messages per kontakt.
- `frontend/src/api.ts` (ändra) — `fetchContactConversation`.
- `frontend/src/components/ConversationInbox.tsx` (ny) — tråd per kontakt över kanaler.

**Klart när**
- En kontakts alla `messages` (chat/voice/email/sms/webhook) visas som en tidsordnad tråd.

---

## SCC-27 — Master Brain CRM-verktyg

**Fas:** F1 · **Prio:** P1 · **Kräver:** SCC-22/24

Där SCC blir *bättre* än GHL: Alex kan läsa och flytta CRM-data via chatt.

**Filer**
- `backend/src/llm/tools.ts` (ändra) — `get_contact`, `list_contacts`, `move_opportunity`, `log_interaction`.

**Klart när**
- Verktygen finns i `ALEX_TOOLS`, har handlers i `executeToolCall` och formattering i `formatToolResultForLLM`.
- `move_opportunity` och `log_interaction` följer ToolResult-mönstret; kund-påverkande skrivningar loggas som activity.

---

## Risker (hantera tidigt)

1. **Intake i produktion.** SCC-23 rör live lead-flödet. Enhetstester av mappningen
   skrivs och körs innan intake ändras.
2. **Idempotens.** Återanvänd `dedupe_key` från `leads.ts` så en lead som kommer två
   gånger inte skapar två contacts.
3. **Spegla i GHL.** Sätt GHL:s pipeline-stages/tags/custom fields identiskt med detta
   schema så framtida cutover blir CSV-import, inte ombyggnad.
