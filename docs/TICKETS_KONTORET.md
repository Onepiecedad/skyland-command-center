# SCC-49 · Kontoret som operativ kontrollyta

> Skapad: 2026-08-30 · Källa: Joakims feedback på Kontoret-vyn under beauty-batchen 30 aug
> ("älskar att se agenterna arbeta tillsammans — kan vi höja upplevelsen?").
> Läggs bredvid `TICKETS_GHL_DERIVED_1.md`. Byggs EFTER fas 2 är stängd; inget här
> blockerar Skuggveckan eller autosend-beslutet 7 sep.

**Var:** `frontend/src/pages/OfficeView.tsx` (data via `GET /api/v1/agents/office` +
gateway-websocket). Ny data finns redan i `costs` (plan 2.4: en rad per pipeline-körning
med `meta = {contact, vertical, attempts, duration_s, result}`) och i kortens
`custom.research_attempts`. Inga nya skrivvägar behövs för etapp 1–2.

**Princip:** vyn är redan säljbar som skådespel. Ärendet gör den ÄRLIG — samma yta ska
svara på "vad händer, vad kostar det, går något snett" utan att terminalen behövs.

---

## Etapp 1 — Batchkortet (störst värde, bygg först)

En pågående `prospect_batch` ska synas som EN sammanhållen körning i Kontoret, inte som
lösa researcher-delegeringar.

**DoD:**
- [ ] Backend: `GET /api/v1/agents/office` utökas med `batch`: aggregat ur `costs` för
      innevarande dag där `agent='pipeline:prospect'` — antal klara/omkörda/misslyckade
      (ur `meta.result`/`meta.attempts`), ackumulerad `cost_usd`, snitt `duration_s`,
      senaste kortnamn. Pågående = rader senaste 20 min.
- [ ] Frontend: kort i Kontoret när batch pågår: "Beauty-batch · 9/25 klara · 1 omkörning ·
      0 fel · $0.21 · klar ~21:40" (ETA = snittid × återstående / 3 parallella).
- [ ] Kortet ligger kvar 1 h efter sista raden med slutsiffror, sedan borta.
- [ ] Fungerar i mobilbredd (Joakim följer batchar från soffan).

## Etapp 2 — Ärliga noder

- [ ] Researcher-nodens "Arbetar…" ersätts med vad: kortets namn + försök (1/2) +
      förloppsring mot researchens 600 s-tak (starttid från delegeringen).
- [ ] Utfallsglöd 10 min efter avslut: grön = klart, bärnsten = omkörning räddade kortet
      (`attempts=2, result=ok`), röd = misslyckat. Datakälla: samma `costs.meta`.
- [ ] Nodens senaste 5 utfall som små prickar under statusraden (minne, inte bara nu).

## Etapp 3 — Läsbart delegeringsflöde

- [ ] Rå JSON i "Senaste delegeringar" skrivs om till människospråk i frontend:
      `{"query":"\"Shine Klinik\" Göteborg mesoterapi","provider":"brave"}` →
      "Söker: Shine Klinik — mesoterapi (Brave)". Mönster per verktygstyp
      (webbsök, apify-google-reviews, scrapling, leverans, ok-kvitto); okända
      verktyg faller tillbaka på dagens JSON.
- [ ] Leveransrader behåller tokens + $ (uppskattat) som idag — det är rätt data.

## Etapp 4 — Puls och hälsa (estetik + vakt)

- [ ] Kanten Alex→arbetande agent pulserar (animerad gradient längs linjen) medan
      sessionen är aktiv; stillastående linje = inget arbete. Respektera
      `prefers-reduced-motion`.
- [ ] Diskret hälsorad i sidhuvudet: tre lampor — integrationshälsa (grön/röd ur
      `/api/v1/integrations/health`, cachea 60 s), poller-heartbeat (kopplas till
      watchdogen i plan 3.3 när den finns; tills dess senaste `/claw/pending`-anrop),
      drift (senaste `drift_check`-utfall när Alex kör den i digest, plan 3.2).
      Klick → System-fliken.

## Uttryckligen INTE i scope

- Ingen ny skrivväg från batch-skripten (costs-mätaren räcker som källa).
- Inga ljud.
- Den flytande navigeringswidgeten är AVSIKTLIG och ska inte "lagas".

**Verifiering (hela ärendet):** starta en batch på 3 kort → Kontoret visar batchkortet med
räknare som tickar, researcher-noden visar kortnamn + ring, flödet är läsbart utan
JSON-ögon, och när ett kort tvingas till omkörning (t.ex. `--attempts 2` + strypt timeout
i test) glöder noden bärnsten. Terminalen behövs inte för något av det.
