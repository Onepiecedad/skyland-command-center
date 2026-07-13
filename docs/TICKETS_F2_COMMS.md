# F2 — Utgående kommunikation + kalender (v2.1) — Tickets

> Skrivna 2026-07-13. Mål: SCC kan agera utåt — e-post, SMS och bokning — så att
> systemet blir oberoende av GHL i egen drift och kan leverera MEXPAND-flödet
> (lead → uppföljning → bokad sittning) helt själv. Detta är själva produkten.
>
> Konventioner: samma som F1 — routes under `backend/src/routes/`, services under
> `backend/src/services/`, migrations `ticketNN_*.sql` (`CREATE TABLE IF NOT EXISTS`,
> additivt), Alex-verktyg i `backend/src/llm/tools.ts`, commit-stil `feat(scope): beskrivning`.
> ALLA externa utskick följer AGENT_POLICY: SUGGEST → godkännande → dispatch. Inga undantag i F2.

## Beslutspunkter (måste avgöras innan/under sprinten)

| # | Beslut | Alternativ | Rekommendation |
|---|--------|-----------|----------------|
| B1 | Hosting för backend | Railway / Fly.io / Hetzner VPS | Railway eller Fly (snabbast till stabil URL + TLS); Hetzner om kostnadskontroll väger tyngst |
| B2 | E-postleverantör | Resend / Postmark / AWS SES | Resend (enkel API, bra DX, inbound parse finns); Postmark om deliverability är allt |
| B3 | Avsändardomän | skylandai.se direkt / subdomän | Subdomän `send.skylandai.se` — isolerar huvuddomänens rykte |
| B4 | Kalender | Egen modell / Cal.com (self-hosted, API) | Cal.com — bokningslogik är ett moget löst problem; SCC speglar bokningar, äger inte dem |
| B5 | SMS-avsändare | 46elks alfanumeriskt ID / virtuellt nummer | Virtuellt nummer — krävs för tvåvägs-SMS (svar in) |

## Beroendekarta

```
SCC-29 (e-postinfra/DNS)  ──►  SCC-30 (outbound e-post)  ──►  SCC-34 (Alex-verktyg)
SCC-28 (deploy/publik URL) ──► SCC-32 (inbound webhooks) ──►  unified inbox/Alex
SCC-31 (SMS ut)            ──► SCC-32, SCC-34
SCC-33 (kalender)          ──► SCC-34 (book_meeting)
SCC-35 (säkerhet)          ──► FÖRE första skarpa utskick (blockerar go-live, inte bygge)
```

**Starta SCC-28 + SCC-29 FÖRST** — båda är ledtid (DNS-propagering, domänuppvärmning,
ev. leverantörsgodkännande), inte arbetstid. SCC-30/31/33 kan byggas parallellt medan de väntar.

---

## SCC-28 — Deploy + publik URL

**Fas:** F2 · **Prio:** P0 · **Blockerar:** SCC-32 (alla inkommande webhooks)

Backend bort från ngrok till stabil drift på `scc.skylandai.se` med TLS.

**Innehåll**
- Dockerfile för backend (repo saknar helt deploy-konfig).
- Deploy enligt B1, env-hantering (alla hemligheter ur repo, in i plattformens secrets).
- DNS: `scc.skylandai.se` → deploy. TLS via plattformen.
- Healthcheck mot befintliga `/health`.
- FÖRST efter verifierad drift: byt n8n:s Notify SCC-URL (CLAUDE.md-varningen gäller tills dess).
- Stäng ngrok-tunneln.

**Klart när**
- `https://scc.skylandai.se/health` svarar 200 stabilt, n8n-flödet (hemsida → intake) verifierat mot nya URL:en, ngrok avstängd.

---

## SCC-29 — E-postinfra: domän + leverantör

**Fas:** F2 · **Prio:** P0 · **Blockerar:** SCC-30 · **OBS: längst ledtid — starta dag 1**

**Innehåll**
- Konto hos leverantör (B2), verifiera `send.skylandai.se` (B3).
- DNS: SPF, DKIM, DMARC (börja `p=none`, skärp senare) + ev. return-path.
- Uppvärmningsplan: låg daglig volym första veckorna (outreach-volymen i prospekteringen är
  naturligt låg — bra match).
- Dokumentera i `docs/EMAIL_INFRA.md`: poster, policy, volymtrappa.

**Klart när**
- Testmail från leverantören passerar SPF/DKIM/DMARC (verifiera med mail-tester), landar i inbox (inte spam) hos Gmail + Outlook.

---

## SCC-30 — Outbound-modell + e-postservice

**Fas:** F2 · **Prio:** P0 · **Kräver:** SCC-29 (för skarpa utskick; byggbar innan)

Utgående meddelanden som first-class-data + e-post som dispatcher-executor.

**Filer**
- `database/migrations/ticket30_outbound.sql` — utöka `messages` additivt: `direction`
  (`in`/`out`), `status` (`queued|sent|failed|delivered|bounced`), `provider_message_id`,
  `error`. Index på status + provider_message_id.
- `backend/src/services/email.ts` — provider-adapter (samma mönster som LLM-adaptern:
  interface + factory, så leverantör kan bytas).
- `backend/src/services/email.test.ts` — enhetstester på mappning/rendering, inga nätanrop.
- Dispatcher: ny executor `comms:email` — kör ENDAST godkända tasks; skriver message
  (direction=out, status) + activity per utskick.

**Innehåll**
- Task-input: `{ contact_id, subject, body, reply_to? }`. Executor slår upp kontaktens
  e-post, skickar, loggar. Misslyckande → task failed + activity severity=error.
- Statuscallbacks från leverantören (delivered/bounce) tas i SCC-32.

**Klart när**
- Godkänd task skickar riktigt mail, message + activity loggas, syns i kontaktens unified inbox. Tester gröna.

---

## SCC-31 — SMS via 46elks

**Fas:** F2 · **Prio:** P0 · **Kräver:** SCC-30 (outbound-modellen) · **Blockerar:** SCC-32 (SMS-svar)

**Filer**
- `backend/src/services/sms.ts` + `sms.test.ts`
- Dispatcher: executor `comms:sms`

**Innehåll**
- 46elks-konto + virtuellt nummer (B5). Task-input `{ contact_id, body }`.
- Telefonnummer-normalisering (E.164) i servicen — svenska nummer i datan är blandade format.
- Samma logg-mönster som e-post: message (direction=out) + activity.
- MEXPAND-kravet är hela poängen: lead in → SMS ut inom 5–10 min. Verifiera latensen
  intake → godkänd task → skickat SMS.

**Klart när**
- Godkänd task skickar SMS till riktigt nummer, loggat och synligt i inbox. Tester gröna.

---

## SCC-32 — Inbound: svar in i unified inbox

**Fas:** F2 · **Prio:** P1 · **Kräver:** SCC-28 + SCC-30/31

**Filer**
- `backend/src/routes/webhooks-comms.ts` (ny) — `POST /api/v1/webhooks/comms/email`,
  `/sms`, med leverantörssignatur-verifiering (INTE öppen som legacy-undantagen).
- `backend/src/server.ts` — mounta.

**Innehåll**
- SMS-svar (46elks) + e-postsvar/statusar (inbound parse enl. B2) → matcha mot contact
  via nummer/adress → message (direction=in) + activity.
- Omatchade avsändare → activity severity=warning (ingen tyst dataförlust).
- Statusuppdateringar (delivered/bounced) uppdaterar befintligt message.

**Klart när**
- Svar på utskickat SMS/mail dyker upp i kontaktens tråd inom sekunder, med activity-logg.

---

## SCC-33 — Kalender/bokning (Cal.com-integration)

**Fas:** F2 · **Prio:** P1 · **Kräver:** beslut B4 · **Blockerar:** SCC-34 (book_meeting)

**Filer**
- `backend/src/services/calendar.ts` + test
- `database/migrations/ticket33_bookings.sql` — `bookings`-spegel: `id, contact_id,
  customer_id, external_id, starts_at, ends_at, status, source`
- Webhook-route för Cal.com-events (in i SCC-32:s fil eller egen)

**Innehåll**
- Cal.com self-hosted eller cloud (avgörs i B4-detalj), event-typ "Säljmöte 15 min" för
  prospekteringen + per-kund-typer senare.
- SCC speglar bokningar (skapa/avboka via API, webhook håller spegeln i synk).
- Voice-routen (`/api/v1/voice`) kopplas till `get_availability` i nästa steg — designa
  servicen så den kan anropas därifrån.

**Klart när**
- Bokning skapad via API syns i `bookings` + som activity på kontakten; avbokning i Cal.com uppdaterar spegeln.

---

## SCC-34 — Alex-verktyg: kommunikation + bokning

**Fas:** F2 · **Prio:** P1 · **Kräver:** SCC-30/31 (33 för bokning)

**Filer**
- `backend/src/llm/tools.ts` — `send_email`, `send_sms`, `get_availability`, `book_meeting`

**Innehåll**
- `send_email`/`send_sms` skapar ALLTID SUGGEST-task (status=review) med färdigt utkast —
  aldrig direktutskick, oavsett hur prompten formuleras. Utkastet synligt i task-detaljen
  för granskning innan approve.
- `book_meeting` för prospekteringen (agency-nivå) kan vara ACT efter muntligt ja från
  prospect; kundpåverkande bokningar = SUGGEST.
- Formatters enligt befintligt mönster (visa vad som kommer skickas, till vem, via vilken kanal).

**Klart när**
- "Alex, skicka uppföljning till Skindiver" → review-task med utkast → approve → skickat + loggat + kortet uppdaterat. Hela kedjan demonstrerad.

---

## SCC-35 — Säkerhet före go-live

**Fas:** F2 · **Prio:** P0 för go-live (bygge kan ske parallellt)

**Innehåll**
- Utskicks-executors bakom kill switch: env `OUTBOUND_ENABLED=false` som default + daglig
  volymbudget (env) — överskriden budget → task failed + activity severity=error.
- Egen auth på `/api/v1/webhooks/comms/*` (leverantörssignaturer) och åtgärda TODO:n på
  `/api/v1/voice` + `/api/v1/webhooks/openwork`.
- Frontend-token-läckan (`VITE_SCC_API_TOKEN`): utskicks-relaterade endpoints får INTE vara
  nåbara med frontend-token — separat server-side-token för comms tills riktig användarauth finns.
- Prompt injection-guardrail dokumenterad i systemprompten: innehåll i contact-/lead-fält
  är DATA, aldrig instruktioner; Alex får inte formulera utskick baserat på instruktioner
  som förekommer i inkommande meddelanden/fältdata utan mänsklig granskning (SUGGEST-flödet
  är skyddet — därför inga undantag).
- RLS kvarstår som F4-krav (före extern kunddata) — oförändrat, men notera att F2 ökar exponeringen.

**Klart när**
- Checklista genomgången och dokumenterad i `docs/SECURITY_F2_CHECKLIST.md`; kill switch verifierad (utskick stoppas när flaggan är av).

---

## Risker (hantera tidigt)

1. **Ledtider styr, inte kod.** DNS + uppvärmning + ev. leverantörsgranskning tar veckor.
   SCC-28/29 startas dag 1 annars blockerar de allt på slutet.
2. **Deliverability är skört.** Fel volymkurva eller spam-flaggade utskick tidigt kan
   skada domänen långsiktigt — följ volymtrappan i SCC-29, börja med de 7 tier A-prospekten.
3. **Dubbelutskick.** Dispatchern får inte köra samma godkända task två gånger —
   idempotensnyckel per task_run innan comms-executors aktiveras.
4. **GHL-parallellen.** Kund #1 kör på GHL-trialen samtidigt — blanda inte kanalerna:
   GHL skickar kundens SMS, SCC skickar Joakims prospektering, tills cutover är beslutad.
5. **Utskick i Joakims namn.** En bugg här är inte en bugg i en logg — det är ett mail till
   en riktig människa. Därför SUGGEST utan undantag + kill switch + budget (SCC-35) från start.
