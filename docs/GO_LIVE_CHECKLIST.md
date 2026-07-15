# Go-live-checklista — utgående sekvenser skarpt

> Uppdaterad 2026-07-15. Allt nedan är CONFIG, inte kod. Ordningen spelar roll.
> Status per steg: markera med [x] när klart.

## Steg 1 — Aktivera bokningspåminnelser (kan göras NU, inget beroende)

Sekvensen "MEXPAND — Strategisamtal påminnelser" (booking_created) behöver inte inbound-mejl.
DM:sen är ute — bokar en studio via Cal.com utan att denna är aktiv får de inga påminnelser.

- [ ] Render: `OUTBOUND_ENABLED=true`
- [ ] Render: `SEQUENCE_RUNNER_ENABLED=true` (ska redan vara satt — verifiera)
- [ ] SCC → Sekvenser-fliken: sätt "Strategisamtal påminnelser" → **active**
- [ ] Valfritt: "No-show uppföljning" → active (OBS: SMS:et i steg 3 skickas alltid
      tills inbound-mejl är kopplat — `has_replied` ser inga svar)

## Steg 2 — SMS (krävs för påminnelse-SMS:et −1h och no-show-SMS)

- [ ] Skapa 46elks-konto + köp virtuellt nummer
- [ ] Render: `ELKS_API_USERNAME`, `ELKS_API_PASSWORD`, `ELKS_SMS_FROM`
- [ ] Verifiera i System-fliken → Integrationer (46elks ska visa "Uppe")

Utan detta: SMS-steg loggas som synlig warn-activity (aldrig tyst skip) — mejlen går ändå.

## Steg 3 — Inkommande mejl (GATE för kalla drippen)

Utan detta ser `has_replied`/`reply_received` inga svar → drippen fortsätter maila
folk som redan svarat. Aktivera INTE kalla drippen före detta steg.

- [ ] Resend Inbound (eller Mailgun Routes): skapa inbound-adress, t.ex. `svar@skylandai.se`
- [ ] MX-post hos one.com för subdomän/adress enligt leverantörens instruktion
- [ ] Reply-to i utgående mejl → inbound-adressen
- [ ] Leverantörens webhook → `https://scc.skylandai.se/api/v1/webhooks/email/inbound?token=<EMAIL_INBOUND_TOKEN>`
- [ ] Render: `EMAIL_INBOUND_TOKEN` (Joakim genererade värde 2026-07-15)
- [ ] Testa: skicka mejl till inbound-adressen → kolla att messages-rad skapas +
      att en aktiv enrollment med exit_on reply_received avslutas

## Steg 4 — Kalla drippen skarpt

- [ ] Steg 3 klart och verifierat
- [ ] Sekvenser-fliken: "Kall email-drip (tatuerare)" → **active**
      (länkar inlagda 2026-07-15: mejl 2 → studios.skylandai.se, mejl 3 → Cal.com)
- [ ] Enrolla första batchen manuellt (tier B/C — tier A körs via IG DM)

## Övrigt (ej blockerande)

- [ ] Render: `CALCOM_WEBHOOK_TOKEN` satt + webhook konfigurerad i Cal.com (live-testad 2026-07-15 — verifiera att env överlever deploys)
- [ ] Render: `INTEGRATION_HEALTH_ENABLED=true` (System-fliken har nu Integrationer-panel)
- [ ] Lokalt: `.git/HEAD.lock` + `.git/index.lock` kan ligga kvar efter agent-sessioner —
      ta bort från egen terminal om git klagar vid push
