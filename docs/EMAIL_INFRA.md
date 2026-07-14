# E-postinfrastruktur (SCC-29)

> Beslut (2026-07-13): leverantör **Resend**, avsändardomän **send.skylandai.se**.
> Detta dokument är körboken: kontosetup, exakta DNS-poster, volymtrappa, verifiering.

## 1. Resend-setup (görs av Joakim, ~15 min)

1. Skapa konto på resend.com (logga in med joakim@skylandai.se).
2. Domains → Add Domain → `send.skylandai.se`, region EU (Irland) för GDPR-närhet.
3. Resend visar då 3–4 DNS-poster (exakta värden genereras per konto — kopiera därifrån,
   mallen nedan visar formen).
4. API Keys → Create → scope "Sending access", namn `scc-backend`. Läggs i backend-env
   som `RESEND_API_KEY`. ALDRIG i repot, ALDRIG i frontend-env.
5. (SCC-32, senare) Webhooks → lägg till `https://scc.skylandai.se/api/v1/webhooks/comms/email`
   för events: delivered, bounced, complained.

## 2. DNS-poster (läggs där skylandai.se hanteras)

| Typ | Namn | Värde | Syfte |
|-----|------|-------|-------|
| TXT | `send.skylandai.se` | `v=spf1 include:amazonses.com ~all` (Resend anger exakt) | SPF |
| CNAME/TXT | `resend._domainkey.send.skylandai.se` | (genereras av Resend) | DKIM |
| MX | `send.skylandai.se` | (genereras av Resend, för bounce-hantering) | Return-path |
| TXT | `_dmarc.send.skylandai.se` | `v=DMARC1; p=none; rua=mailto:joakim@skylandai.se; fo=1` | DMARC (rapportläge) |

- **DMARC-trappa:** `p=none` första månaden (bara rapporter) → `p=quarantine` när
  rapporterna är rena → `p=reject` när volymen är stabil.
- Huvuddomänen skylandai.se påverkas INTE — det är hela poängen med subdomänen.
- Avsändaradress: `joakim@send.skylandai.se` (display: "Joakim — Skyland AI").
  `Reply-To: joakim@skylandai.se` så svar landar i din vanliga inkorg tills inbound är byggt.

## 3. Volymtrappa (deliverability-skydd)

| Vecka | Max/dag | Innehåll |
|-------|---------|----------|
| 1 | 5 | Tier A-uppföljningar, testmail till egna adresser (Gmail/Outlook/Hotmail) |
| 2 | 10 | + tier B-outreach |
| 3 | 20 | + kunduppföljningar |
| 4+ | 50 | Normaldrift; höj `OUTBOUND_DAILY_LIMIT` gradvis |

Regler: alltid personligt innehåll (inga massutskick från denna domän), stoppa direkt
vid bounce-rate > 5 % eller spam-klagomål, pausa hellre en vecka än att bränna domänen.

## 4. Backend-env (nya variabler, SCC-30)

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=<hemlig>
EMAIL_FROM="Joakim — Skyland AI <joakim@send.skylandai.se>"
EMAIL_REPLY_TO=joakim@skylandai.se
OUTBOUND_ENABLED=false        # kill switch — sätts till true först efter SCC-35-checklistan
OUTBOUND_DAILY_LIMIT=5        # följ volymtrappan
```

## 5. Verifiering (innan första skarpa utskicket)

1. Resend Domains visar "Verified" på alla poster (DNS-propagering: minuter–timmar).
2. Skicka testmail via godkänd task till egen Gmail + Outlook → landar i INBOX, inte spam.
3. Kolla "show original" i Gmail: SPF=PASS, DKIM=PASS, DMARC=PASS.
4. mail-tester.com → poäng ≥ 9/10.
5. Första DMARC-rapporten (kommer inom ~48h till rua-adressen) visar inga okända avsändare.
