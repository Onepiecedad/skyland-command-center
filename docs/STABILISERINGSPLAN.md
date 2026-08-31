# Skyland stabiliseringsplan

Planen som styrde arbetet 30–31 augusti 2026. Fem faser, i ordning: stoppa det som
läcker, skapa en sanning, stabilisera pipelinen, gör systemet självgående, och först
därefter skala.

**Ordningen är själva poängen.** Att bygga påfyllning runt en pipeline som faller
varannan gång, med svar ingen läser, hade varit att skala ett fel.

Det här är en exportkopia. Originalet är artefakten **"Skyland stabiliseringsplan"** i
Joakims artefaktgalleri på claude.ai och har den visuella statusvyn. Båda hålls
uppdaterade — ändras den ena ska den andra följa med.

**Status 31 augusti: 21 av 29 steg klara.** Fas 0, 1 och 2 helt avklarade, plus 3.4.

---

## Fas 0 · Stoppa blödningen · KLAR

**Mål:** Inget skickas utan att du vet om det, och inget som redan är trasigt fortsätter
vara tyst.

- [x] **0.1** Skuggläge på i produktion, kill switch av, manuell kö med "Skicka nu"
- [x] **0.2** Inbound via Resend: MX, webhook, reply-to, kopia till inkorgen
- [x] **0.3** Svarskedjan testad: Gmail → Resend → SCC → kopia i inkorgen *(30 aug)*
- [x] **0.4** Bokningspåminnelser bekräftas för hand tills 1.5 skiljer transaktionsmejl från outreach *(löst i 1.5)*
- [x] **0.5** Radera `scc-backend` på det andra Render-kontot *(30 aug)*
- [x] **0.6** `INTEGRATION_HEALTH_ENABLED=true` i Render *(30 aug)*
- [x] **0.7** Säg upp n8n Cloud, ta bort DNS `n8n.skylandai.se`, radera Netlify-projektet `skylandai` *(30 aug)*

## Fas 1 · En sanning · KLAR

**Mål:** Vem som helst, inklusive en ny AI-session, kan svara på "vad kör just nu" på
under en minut.

- [x] **1.1** `docs/DRIFT.md` — ersätter handovers som nulägesbeskrivning *(30 aug)*
- [x] **1.2** `scripts/drift_check.py` — jämför prod mot DRIFT.md maskinellt *(30 aug)*
- [x] **1.3** Gemensam `env.py` för alla skills, en läsordning *(30 aug)*
- [x] **1.4** `backend/.env` låst till säkra värden — en fil med fel värden är värre än ingen *(30 aug)*
- [x] **1.5** Transaktionsmejl vs outreach: `outbound_policy` per sekvens *(30 aug)*
- [x] **1.6** Rätta minnesfiler och skills från Telegram till WhatsApp *(30 aug)*

**Klart när:** `drift_check.py` ger noll avvikelser, alla skills läser env från samma
modul, och en Cal.com-testbokning ger bekräftelsemejl trots att `OUTBOUND_ENABLED` är
false. ✓

## Fas 2 · Stabil pipeline · KLAR

**Mål:** Research och DM lyckas i minst 85 procent av körningarna, och n8n-beroendena
fungerar eller är borttagna.

- [x] **2.1** n8n avvecklat: alla flöden i SCC, sajt och röst omkopplade *(30 aug)*
- [x] **2.1b** n8n-checkarna i `integrationHealth.ts` bytta mot sajt-checkar *(30 aug)*
- [x] **2.2** Retry i `prospect_batch` + exakt namnmatchning *(30 aug, testat på Laser4you)*
- [x] **2.3** Modelltest: Kimi 10/10 mot DeepSeeks 5/10 på första försöket, 2,7 mot 7,5 min, kostnaden lika. Researchern kör Kimi K2.5 med DeepSeek som fallback *(30 aug natt)*
- [x] **2.4** Kostnads- och tidsmätare per körning i `costs.meta`, även för misslyckade kort *(30 aug)*
- [x] **2.5** Arbetstidsfönster vardagar 08–17 svensk tid + spridning 1–90 min *(30 aug)*
- [x] **2.6** Nio medicinska mottagningar till No Fit + exkluderingsord i beauty-filtret *(30 aug)*

**Klart när:** en batch på 10 kort ger minst 8 klara utan manuell omkörning,
integrationspanelen är grön, och en sekvens med tre kort skickar vid tre olika
tidpunkter inom fönstret. ✓ *(85 procent uppnått)*

## Fas 3 · Systemet går utan dig · PÅGÅR

**Mål:** Svar hanteras, Alex vet vad som händer, och maskinen står inte stilla när
laptopen gör det.

- [~] **3.1** Svarsklassificering — regler fångar autosvar utan LLM-anrop, resten
      klassas av modellen (intresserad, nej, autosvar, fråga, övrigt). Över
      konfidenströskeln flyttas kortet och ett nej spärrar adressen; under den
      loggas klassen men inget händer. Nio enhetstester *(31 aug)*.
      **Kvar:** push till WhatsApp vid intresse — Render når inte tailnetet, så
      den vägen går via en uppgift som pollern hämtar från `/claw/pending`
- [x] **3.2** Daglig digest — ett mejl kl 07 svensk tid med dygnets siffror:
      skickat och misslyckat, skuggrader loggade och kön som väntar på dom, svar
      per klass med hur många som agerades på, nya kontakter, pollerns hjärtslag,
      integrationer och LLM-kostnad. Tom dag mejlas ändå, spärren mot dubbelutskick
      ligger i databasen så en omstart inte skickar två. Nio enhetstester *(31 aug)*
- [x] **3.3** Poller-watchdog — SCC larmar via Resend om `/claw/pending` inte anropats
      på 15 minuter. Hjärtslag i minnet, larm bara vid tillståndsövergång, ingen
      falsklarm vid omstart. Sju enhetstester *(31 aug)*
- [x] **3.4** Alex flyttad till VPS: Hetzner CPX22 i Helsingfors, Ubuntu 26.04, gateway
      och poller som systemd-tjänster med linger. WhatsApp-sessionen överlevde utan
      omparning. Macen kan stängas *(31 aug natt)*
- [~] **3.5** Inventering gjord: `docs/OPENCLAW_CONFIG_INVENTERING.md` — live, arkiv
      eller död per katalog, med fyra fynd som inte kan vänta (repots master-config
      är Mac-formad och skulle stänga av Tailscale vid deploy; två cronjobb kraschar
      varje körning; inget schemalagt jobb har kört sedan flytten; Macen kör
      fortfarande daily-ops varje morgon) *(31 aug)*.
      **Kvar:** Joakim godkänner listan, sedan flytt och gitignore
- [ ] **3.6** **Autosend-beslut efter skuggveckan** — över 90 procent "hade skickat" och
      underkända med kodbara skäl ⇒ validatormodell som scorar utkast, över tröskel
      autosend, under tröskel manuell kö *(Joakim beslutar, 7 sep)*

## Fas 4 · Volym · EJ PÅBÖRJAD

**Mål:** Först nu byggs påfyllningen.

- [ ] **4.1** Daglig discover-cron — fyll på till N kort per vertikal och stad, dedupe
      mot CRM och suppression, kostnadstak per dag
- [ ] **4.2** Automatisk enroll av kort över poänggräns, resten till manuell hög
- [ ] **4.3** Nästa vertikal (tandläkare eller verkstad) som egen vertikalfil med egen
      scoring, brief och DM-doktrin *(Joakim sätter doktrin)*

---

## Deadlines

| När | Vad |
|---|---|
| 1 sep efter 17:03 | Skuggveckan: sju kort får skuggrader, ska dömas. Underlag till 3.6 |
| 7 sep | Autosend-beslutet (3.6) |

## Relaterade dokument

| Dokument | Innehåll |
|---|---|
| `DRIFT.md` | Vad som kör just nu — läs den först |
| `HANDOVER_2026-08-30.md` | Arbetsdagbok: vad som gjordes, vilka buggar som hittades |
| `BACKLOG_2026-08-31.md` | Vad som ska göras härnäst, prioriterat efter konverteringsdata |
| `VPS_MIGRATION.md` | Flytten av Alex (3.4) och de fällor den avslöjade |
| `TICKETS_KONTORET.md` | SCC-49, Kontoret som operativ kontrollyta |
