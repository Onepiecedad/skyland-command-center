# GHL AAC-snapshot — arkitektur & funktion

> Kartlagt 2026-07-15 direkt i kontot. Snapshot som följer med Ai Agency Course (AAC).
> Installerat i sub-kontot **Skyland AI System / Mölndal** (location `TjhLIXpqrGOjkQ9DoCrS`).
> **Allt är inaktivt / draft just nu** — installerat men inte påslaget.

## Snapshots (agency-nivå)

- **AAC (Agency)** — v0. Byråns eget system (kundanskaffning).
- **AAC (Kund 2.0)** — v1. Mall för kundleverans (det du sätter upp åt dina kunder).

Sub-kontot ovan kör AAC-systemet för din egen byrå-kundanskaffning.

## Vad som finns i kontot (bekräftat)

### Pipelines (Opportunities)

| Pipeline | Steg | Roll |
|----------|------|------|
| **MEXPAND** | Lead 📞 → Svara 💬 → Book a Session 📅 → Closed 🚀 → Follow up ↩️ (5 synliga, GHL anger 6) | Kärn-resan prospekt → kund |
| **Strategisamtal** | Scheduled → No Show → Closed | Säljsamtalets delprocess |
| **Kick-Off Möte** | 1 steg | Onboarding efter signering |

### Kalendrar (båda **inaktiva**, round robin)

- **Kostnadsfritt Strategisamtal** — 30 min. Säljmötet (gratis konsultation).
- **Kick-Off Möte** — 1 tim. Onboarding-mötet efter att kunden signat.
- Kalendergrupper: `[Your Agency Name]` (platshållare — ej ifylld), `MEXPAND Calendar`.

### Automations (workflows, organiserade i mappar)

- **MEXPAND** (mapp) — kärn-workflows för outreach/nurture. Motorn i systemet.
- **Strategisamtal Calendar Automation** (mapp) — bokningsbekräftelse, påminnelser och
  no-show-uppföljning för säljmötet.
- **Kick-off möte Calendar Automation** (mapp) — bekräftelse/påminnelser för onboarding-mötet.
- **Email Cold Outreach** (fristående, **DRAFT**) — kall-mejlssekvens, top of funnel.

> Not: GHL:s mappnavigering gick inte att öppna via automation, så de enskilda
> workflowsen inuti varje mapp är inte listade nod-för-nod här. Kan grävas fram på
> begäran (öppna en mapp så läser jag av innehållet).

## Hur det hänger ihop funktionellt (MEXPAND-metoden)

Detta är kursens byrå-kundanskaffningssystem. Flödet:

1. **Kall outreach** (Email Cold Outreach-workflowen, + DM/annonser) fyller toppen.
2. Prospektet blir **Lead** i MEXPAND-pipelinen → svarar (**Svara**) →
   bokar in sig på **Kostnadsfritt Strategisamtal** (**Book a Session**).
3. **Strategisamtal Calendar Automation** kör bekräftelse + påminnelser + no-show-recovery.
   Samtalet spåras i Strategisamtal-pipelinen: **Scheduled → No Show → Closed**.
4. Vid avslut (**Closed 🚀**) onboardas kunden via **Kick-Off Möte**-kalendern + dess
   automation + Kick-Off-pipelinen.
5. **Follow up ↩️** fångar de som inte stängt än för återkoppling.

Kärnprincip (rakt ur kursen): varje steg har *ett* jobb, inga priser någonstans —
strategisamtalet säljer. Exakt den tratt kursen lär ut (kall outreach → boka möte →
säljsamtal → stäng → onboarda).

## Status & vad som krävs för att aktivera

Allt är inaktivt/draft. För att systemet ska rulla:

- Ersätt platshållaren `[Your Agency Name]` (kalendergrupp m.m.).
- Konfigurera kalender-tillgänglighet och koppla din kalender. (OBS: detta system använder
  GHL:s egna kalendrar — inte din Cal.com som `studios.skylandai.se` pekar mot.)
- Koppla e-post, telefon/SMS och domän i sub-kontot.
- Granska varje workflows texter (troligen mix svenska/engelska + platshållare).
- Aktivera kalendrarna och workflowsen; publicera Email Cold Outreach (den är Draft).

## Strategisk notering — två parallella spår

Det här GHL-AAC-systemet är en **färdig, parallell** motor för samma sak du redan byggt
själv: boka säljmöten från kall outreach. Du har alltså två spår som överlappar:

- **(a) Ditt egenbyggda Skyland-system:** SCC-CRM, IG-DM-motor, karuseller,
  `studios.skylandai.se` + Cal.com.
- **(b) Kursens GHL-AAC-snapshot:** pipelines + kalendrar + workflows ovan.

Båda löser prospekt → bokat möte. Att köra **båda** parallellt splittrar fokus och data
(två CRM, två kalendersystem, två outreach-motorer). Värt att medvetet bestämma: kör du
GHL-AAC som färdig motor och lägger ditt egna bygge åt sidan, eller tvärtom — eller
plockar delar ur båda? Inte bråttom, men ett beslut värt att ta innan du lägger tid på
att aktivera GHL-systemet.
