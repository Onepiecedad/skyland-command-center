# SCC — Kravlista härledd ur GHL-analysen

> Skapad: 2026-07-14 · Källa: `Djupanalys_av_GoHighLevel.pdf` · Ägare: Joakim
> Läggs bredvid `TICKETS_F1_CRM.md` / `TICKETS_F2_COMMS.md`.
> Detta är inte research att läsa — det är en obduktion av produkten SCC ska ersätta.

## Så här använder du listan

GHL:s kärnsvaghet är **ojämn funktionalitet** — bred funktionslista, inkonsekvent
utförande. SCC vinner inte på att matcha bredden, utan på att nita djupet i en smal vertikal
med Alex som absorberar komplexiteten. Varje rad nedan är ett ställe där GHL bevisligen
fallerar operativt = ett ställe där SCC måste göra rätt från början. Prioriteringen följer
**operativ skada**, inte hur högt något låter.

---

## P1 — affärskritiskt (bygg in i F2, före volym)

### SCC-36 · Attribution på kontaktnivå (förstklassigt designmål)
**GHL-felet:** Attribution/rapportering olöst sedan 2019. "Dataexport kräver att man går
runt manuellt i CRM." Näst mest konsekventa gapet i hela analysen.
**Varför för dig:** Hela affären är provision (15–20 % av försäljningsvärde). Utan
attribution kan du varken bevisa ROI för kund eller räkna ut din egen faktura.
**DoD:**
- [ ] `messages`/`activities` kan knyta hela kedjan: lead → kontakt → opportunity → bokning → betalning.
- [ ] Attribution täcker mail, formulär, bokning, samtal och betalning — inte bara ett fält.
- [ ] En enda exportväg (CSV/JSON) för de vanligaste rapporterna, inte klick-runt i UI.
**Koppling:** bygger på F1 (contacts/opportunities/messages) + F2 (comms-status).

### SCC-37 · Integrations-hälsa (health checks + self-heal)
**GHL-felet:** Integrationer dör tyst av token-bortfall. "Kalenderbokningar slutade fungera
slumpmässigt, ingen hade ändrat något."
**Varför för dig:** 46elks, Cal.com, Resend, Meta Lead Ads, n8n — allt token-baserat och
på väg in. Samma tysta driftstopp skulle träffa din leverans (MEXPAND).
**DoD:**
- [ ] Health check per kritisk integration, synlig i System-fliken.
- [ ] Token-expiry-varning *innan* något går sönder (task/notis).
- [ ] Självläkande reconnect-flöde där det går; annars SUGGEST-task till dig.
- [ ] Täcker även den kända skulden: Supabase realtime som timar ut från Render.
**Koppling:** blockera INTE, men landa före SCC-31/32/33 går skarpt mot kund.

### SCC-38 · En valideringsväg + explicit "send from"
**GHL-felet:** Workflows använder annan validering än Contacts/Messaging → meddelanden
hoppar tyst över kontakter eller misslyckas utan spår.
**Varför för dig:** Tyst fel är dödsstöten för förtroende när du skickar i eget namn.
**DoD:**
- [ ] Exakt EN valideringsväg genom intake → contact → message → dispatch.
- [ ] Explicit avsändarval per utskick (nummer/domän/svarsadress), inget dolt default.
- [ ] Misslyckad validering = synligt fel + logg, aldrig tyst skip.
**Koppling:** utökar SCC-34 (`send_email`/`send_sms`). SUGGEST-ryggen är redan ett skydd — håll den enda vägen.

### SCC-39 · Billing- och attributionstransparens (din provisionsvy)
**GHL-felet:** Wallet/usage/telefoni/AI-tillägg → "chockfakturor" och tvister.
**Varför för dig:** Din provisionsfaktura måste vara lika transparent för kunden som den
saknas hos GHL — det är en direkt säljpoäng för "The Honest Builder".
**DoD:**
- [ ] Per-kund-vy: vilka bokningar/intäkter din provision baseras på, spårbart till källan.
- [ ] Inga dolda poster — kunden ska kunna följa "varför den här siffran".
**Koppling:** följer direkt av SCC-36.

---

## P2 — adoption & din egen yta (F2–F3)

### SCC-40 · Håll operatörsdashboarden disciplinerad (anti-UX-svällning)
**GHL-felet:** #1-klagomålet i hela analysen. "Rörigt kaos vid första inloggningen,
inställningar i tre olika menyer", 141 omnämnanden av learning curve.
**Varför för dig:** Kundens yta skyddas av att Alex ÄR gränssnittet. Men ditt kontrollrum
löper exakt samma risk — och tidiga tecken finns redan (approval-vyn ej globalt mountad,
agency-tasks osynliga).
**DoD:**
- [ ] Mounta ApprovalQueue/PendingApprovals globalt (System-fliken) — agency-tasks (`customer_id=null`) syns.
- [ ] En konsekvent väg till inställningar, inte modul-per-modul.
- [ ] Ny funktion får inte lägga till en ny meny utan att en gammal motiveras bort.
**Koppling:** löser även den kända UI-luckan från 14/7.

### SCC-41 · CRM merge/dedupe-disciplin
**GHL-felet:** Dubbletter, dataöverskrivning, förlorad betalnings-/aktivitetsdata vid merge.
**Varför för dig:** `dedupe_key` finns redan (idempotent intake) — skydda datan vid merge nu, innan volym.
**DoD:**
- [ ] Merge bevarar all betalnings- och aktivitetshistorik (ingen tyst överskrivning).
- [ ] Merge-logg i `activities` (audit).
**Koppling:** F1-entiteten `contacts`.

---

## P3 — white-label-polish (F4, lång ledtid — starta tidigt)

### SCC-42 · Branding-audit av alla auth-flöden
**GHL-felet:** White-labelad forgot-password-sida läcker ändå GHL-logga + kontaktuppgifter.
Liten teknisk detalj, stor i white-label-affären.
**DoD:**
- [ ] Full audit av auth-, reset-, invite- och systemmail-flöden — noll Skyland-branding i kundinstans.
- [ ] Egen domän per kund vid Resend Pro-konsolidering (redan noterad F4-skuld).

### SCC-43 · Behåll direkt supportmodell som säljpoäng
**GHL-felet:** Subaccount-kunder kan inte kontakta HighLevel direkt — kärnfrustration.
**Varför för dig:** Du ÄR operatören och supporten. Den fällan undviker din modell helt —
gör det till uttalad positionering, inte en slump.
**DoD:**
- [ ] Kunden når en människa (dig) direkt; ingen svart låda mellan kund och drift.

---

## Bygg INTE (medvetna icke-mål)

- **Website builder i SCC.** 1,3k röster hos GHL, men irrelevant för dig — du kör redan
  React/Netlify för sajter. Bygg aldrig in en sidbyggare i kärnan.
- **Strukturellt beroende av GHL:s agency-API.** "Under review" sedan 2022. LeadConnector-MCP
  funkar för att hämta *data*, inte *struktur*. Få ut datan vid cutover (CSV-import) och gå vidare.
- **Modul-per-modul-inställningar.** Källan till GHL:s UX-svällning. Rollbaserade, use-case-drivna
  vyer i stället.

---

## En rad att minnas

> GHL:s största svaghet är inte avsaknad av funktioner — det är skillnaden mellan bred
> funktionslista och konsekvent utförande. SCC:s hela existensberättigande är att stänga
> det gapet i en smal vertikal. Varje gång du frestas lägga till bredd i stället för djup:
> läs om den här raden.
