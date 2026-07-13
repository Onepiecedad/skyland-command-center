# Skyland Command Center — TODO / Backlog

## Säkerhetsskuld (måste stängas före extern kunddata / F4)

- [ ] **RLS avstängt** på alla kärntabeller (inkl. nya `contacts`). Aktivera RLS + skriv policies. Aktivera INTE utan policies — låser all åtkomst.
- [ ] **Frontend-token-läcka:** `VITE_SCC_API_TOKEN` + `VITE_GATEWAY_TOKEN` bakas in i bundlen. Ersätt med riktig användarauth.

## Prospektering (Joakims egen kundanskaffning — pågår)

- [x] Pipeline "Prospecting (Agency)" + 37 tatuerar-leads inlagda, berikade & scorade (2026-07-13).
- [x] CRM-kort visar score/IG/kanal + sort/filter på tier.
- [ ] **DM-öppningsrader för tier A** (7 studior) — nästa steg för outreach.
- [ ] Skala listan mot ~100 (fler Göteborgs-områden/angränsande orter) — valfritt.
- [ ] Verifiera de ~12 JS-renderade sajternas bokningsflöde (nu default `form`) om exaktheten behövs.
- [ ] Outreach-modul: IG DM som huvudkanal (tatuerare bokar via DM, inte mail).

## Roadmap (från GHL-analysen)

- [ ] **F2:** utgående e-post (Resend/Postmark), SMS (46elks), kalender/bokning. Se `docs/HANDOVER-CRM-F1-och-leadlista.md`.
- [ ] **F3/F4:** workflow-byggare, snapshots, Stripe-rebilling (sist).

## High Priority

- [ ] **Safari WebSocket fix**: Set up `wss://` for the Alex gateway (e.g. via ngrok/Cloudflare Tunnel) so Safari can connect from the HTTPS Netlify frontend. Currently Safari blocks `ws://` from `https://` pages (mixed content). Chrome works because it exempts localhost.

## Medium Priority

- [ ] Code-split the JS bundle (currently 1.1 MB) using dynamic `import()` for route-level splitting
- [ ] Add error boundary around 3D Realm canvas so WebGL crashes don't take down the whole app

## Low Priority / Nice-to-have

- [ ] Add markdown rendering in chat messages (bold, lists, code blocks)
- [ ] Add timestamps to chat messages
