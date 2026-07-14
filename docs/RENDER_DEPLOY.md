# Render-deploy (SCC-28) — körbok

> Mål: backend (+ SPA) live på `https://scc.skylandai.se`, ngrok avstängd.
> Dockerfilen i `backend/Dockerfile` bygger BÅDE frontend och backend till en container.

## 0. Förkrav

- [ ] `git push origin main` körd — Render bygger från GitHub, inte din disk.
- [ ] `backend/.env` till hands (värdena ska in i Renders env-panel).

## 1. Skapa tjänsten

1. dashboard.render.com → **New** → **Web Service**.
2. **Connect GitHub** → välj `Onepiecedad/skyland-command-center` (godkänn Render-appen för repot om den frågar).
3. Inställningar:

| Fält | Värde | Kommentar |
|------|-------|-----------|
| Name | `scc` | blir `scc-xxxx.onrender.com` |
| Region | Frankfurt (EU) | närmast + GDPR |
| Branch | `main` | |
| Language/Runtime | **Docker** | |
| Root Directory | **(lämna tomt)** | Dockerfilen kopierar `frontend/` + `backend/` från repo-roten |
| Dockerfile Path | `backend/Dockerfile` | |
| Instance Type | **Starter** (~$7/mån) | INTE Free — den somnar och missar webhooks/leads |

## 2. Environment Variables

Klicka **Advanced** → Add Environment Variable. Kopiera värdena från `backend/.env`:

```
SUPABASE_URL=https://wfwqjxsuvbacvcmpiesl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<från .env>
SCC_API_TOKEN=<från .env>
LEADS_INTAKE_TOKEN=<från .env>
LLM_PROVIDER=openrouter
LLM_MODEL=<från .env>
OPENROUTER_API_KEY=<från .env>
SCC_PUBLIC_BASE_URL=https://scc.skylandai.se
N8N_WEBHOOK_URL=<från .env om satt>
OPENCLAW_HOOK_URL=<från .env om satt>
OPENCLAW_HOOK_TOKEN=<från .env om satt>
ELEVENLABS_API_KEY=<från .env om satt>
ELEVENLABS_AGENT_ID=<från .env om satt>

# E-post (SCC-30) — kill switch AV tills SCC-35-checklistan är klar
EMAIL_PROVIDER=resend
RESEND_API_KEY=<från Resend, kontot joakim123>
EMAIL_FROM=Joakim — Skyland AI <joakim@send.skylandai.se>
EMAIL_REPLY_TO=joakim@skylandai.se
OUTBOUND_ENABLED=false
OUTBOUND_DAILY_LIMIT=5
```

- Sätt INTE `PORT` — Render injicerar den och servern läser env.
- Utelämna variabler du inte har värde för (config kraschar bara på de obligatoriska:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SCC_API_TOKEN + LLM-nyckeln för vald provider).

## 3. Health check + deploy

1. **Advanced** → Health Check Path: `/health/live`.
2. **Create Web Service** → första Docker-bygget tar 5–10 min.
3. Grönt = testa `https://scc-xxxx.onrender.com/health` → ska ge 200.

## 4. Eget domännamn

1. Render → tjänsten → **Settings → Custom Domains** → `scc.skylandai.se`.
2. Render visar ett CNAME-mål (`scc-xxxx.onrender.com`).
3. one.com → DNS records:
   - **Ta bort** befintlig A-post `scc` → `207.154.220.13` (pekar på gamla VPS:en).
   - **Skapa CNAME**: hostname `scc`, värde = Renders mål.
4. Render verifierar + utfärdar TLS automatiskt (minuter).
5. Testa `https://scc.skylandai.se/health` → 200.

## 5. Cutover (först när steg 4 är verifierat)

1. n8n: byt Notify SCC-URL (void-submission + voice-call-ended) från ngrok-adressen
   till `https://scc.skylandai.se/api/v1/leads/intake`.
2. Skicka test-lead via hemsidan → verifiera att contact skapas i CRM:et.
3. Stäng ngrok-tunneln.
4. Uppdatera CLAUDE.md-notisen om ngrok (backend är nu deployad).

## Kända begränsningar

- **SPA:n på Render saknar VITE_-tokens.** Frontend-bundlen byggs i Docker utan
  `VITE_SCC_API_TOKEN`/`VITE_GATEWAY_TOKEN` (de bakas in vid byggtid och ligger inte i repot).
  Dashboarden på scc.skylandai.se kan alltså inte autha mot API:t ännu. Kör frontend lokalt
  mot Render-API:t tills vidare. Riktig fix = riktig användarauth (SCC-35/F4) — vi vill INTE
  baka in tokens i en publik bundle igen.
- **Auto-deploy:** varje push till `main` triggar ny deploy (default på). Rimligt nu;
  stäng av om det stör.
