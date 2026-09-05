# Skyland Command Center — TODO / Backlog

> **Den här filen är inte den levande listan.** Den frystes i praktiken i juli
> 2026. Aktuell prioritering: `docs/BACKLOG_2026-08-31.md` och
> `docs/STABILISERINGSPLAN.md`. Aktuellt driftläge: `docs/DRIFT.md`.
>
> Punkter som stod som öppna här och som *är* lösta har rättats 5 sep — en
> osann rad om en säkerhetsskuld är värre än ingen rad, för den läses som en
> öppen lucka av nästa person.

## Infra (klart)

- [x] **Testsvit + CI** (2026-07-21): ~187 backend-tester (vitest), frontend komponent-smokes, Playwright-E2E (login→CRM), GitHub Actions vid varje push. Se "Testning & CI" i `CLAUDE.md`/`README.md`. Kör `npm test` i `backend/` + `frontend/` före push.
- [ ] E2E i CI (kräver `E2E_PASSWORD` som GitHub Secret + körande app) — valfritt nästa steg.

## Säkerhetsskuld (måste stängas före extern kunddata / F4)

- [x] **RLS** — påslaget 2026-08-10 (SEC-01) med policies på samtliga 19 kärntabeller. `anon` spärrad, `authenticated` tenant-isolerad, `service_role` bypassar. Backenden kör som service_role och påverkades inte. Supabase security advisor gick från 20 fynd till 1.
- [x] `VITE_SCC_API_TOKEN` — bakas INTE in i bundlen (kontrollerat mot prod 2026-08-10); frontenden kör cookie-only. Raden borttagen ur `.env.production`.
- [ ] **`VITE_GATEWAY_TOKEN` ligger kvar i bundlen**, medvetet: browsern pratar direkt med OpenClaw-gatewayen. Skadan begränsas av att gatewayen är loopback-bunden bakom Tailscale. Rätt slutläge är att backenden proxar WebSocket:en och håller token serverside.

## Prospektering (Joakims egen kundanskaffning — pågår)

- [x] Pipeline "Prospecting (Agency)" + 37 tatuerar-leads inlagda, berikade & scorade (2026-07-13).
- [x] CRM-kort visar score/IG/kanal + sort/filter på tier.
- [x] **DM-öppningsrader** — `dm_pipeline` med kodgrindad stilvalidering, per vertikal. Tattoo och beauty i drift.
- [ ] Skala listan mot ~100 (fler Göteborgs-områden/angränsande orter) — valfritt.
- [ ] Verifiera de ~12 JS-renderade sajternas bokningsflöde (nu default `form`) om exaktheten behövs.
- [ ] Outreach-modul: IG DM som huvudkanal (tatuerare bokar via DM, inte mail).

## Roadmap (från GHL-analysen)

- [x] **F2:** utgående e-post (Resend) och kalender/bokning (Cal.com) i drift. Sekvensmotorn med skuggläge, suppression, dagsbudget och outreach-fönster kör i produktion. SMS finns i koden men används inte skarpt.
- [ ] **F3/F4:** workflow-byggare, snapshots, Stripe-rebilling (sist).

## High Priority

- [x] **Safari WebSocket** — löst av att gatewayn flyttade till VPS:en och exponeras som `wss://alex.tail8a8e79.ts.net` via `tailscale serve` (31 aug). Ingen ngrok. Kräver `accept-dns` på klienten, annars går `*.ts.net` till publik DNS och ger NXDOMAIN — det var hela "Server-läge"-mysteriet 3 sep.

## Medium Priority

- [ ] Code-split the JS bundle (currently 1.1 MB) using dynamic `import()` for route-level splitting
- [ ] Add error boundary around 3D Realm canvas so WebGL crashes don't take down the whole app

## Low Priority / Nice-to-have

- [ ] Add markdown rendering in chat messages (bold, lists, code blocks)
- [ ] Add timestamps to chat messages
