# Alex till VPS (plan 3.4)

Beslut 30 aug 2026: Alex flyttar från Joakims Mac till en VPS. Skälet är att
gatewayn och pollern bara lever medan datorn är vaken — batchen 30 aug dog mitt i
när locket stängdes, och `caffeinate -i` täcker inte stängt lock.

Det här dokumentet är kartläggningen och flyttplanen. Sanningen om vad som körs
står i `DRIFT.md`; uppdatera den när flytten är gjord.

## Vad Alex faktiskt består av

| Del | Var idag | Flyttar? |
|---|---|---|
| OpenClaw gateway | launchd `ai.openclaw.gateway`, node v24 (nvm), port 18789 loopback | ja, systemd |
| Gateway-watchdog | launchd `ai.openclaw.gateway.watchdog` | ja, systemd `Restart=always` ersätter den |
| SCC-poller | launchd `com.skyland.scc-poller`, `scc_poller.py` var 15:e sek | ja, ren python + utgående HTTP |
| 10 agenter | `~/clawd/_agents/*`, config i `~/.openclaw/openclaw.json` | ja |
| Skills (39 st) | `~/.openclaw/skills` (kanon), repo-kopia i `openclaw-config/skills` | ja, se undantag nedan |
| WhatsApp-kanal | Baileys, sessionsnycklar i `~/.openclaw/credentials/whatsapp/default/` | ja, men se risk nedan |
| Minne | `~/.openclaw/memory` (327 MB) | ja |
| Browserprofil | `~/.openclaw/browser` (2,1 GB) | nej, regenereras |
| Loggrotation | launchd `com.skyland.gateway-err-rotation` | ersätts av logrotate |

Diskbehov: `.openclaw` 3,4 GB varav 2,1 GB är browsercache, `~/clawd` 1,2 GB.
Det som faktiskt ska med är runt 1,5 GB.

## Vad som INTE kan flytta

Kartläggningen var mildare än väntat. Av 39 skills är exakt en genuint Mac-bunden:

- **`apple-calendar`** — AppleScript mot Calendar.app. Ersätts av **`gog-calendar`**
  (Google Calendar via `gogcli`, finns redan installerad som skill, Go-binär som
  kör på Linux). Enda skillen som pekar på apple-calendar är `evening-summary`.
- **`konkurrent_intel.py`** har en lista med Mac-sökvägar till Chrome/Chromium.
  Lägg till Linux-sökvägar i samma lista, inget mer.

Följande är Mac-saker som INTE tillhör Alex och alltså inte berörs: rostpennan,
frontendens dev-server, veckans screenshot-triage (den kör genom Claude mot Photos,
inte genom Alex), iMessage- och Desktop Commander-verktygen.

Hårdkodade `/Users/onepiecedad`-sökvägar i riktig källkod: tre filer (`scrapling`,
`scc-crm`, `proactive-checkin`). Resten av träffarna låg i venv:ar och `__pycache__`.

## Fallgropar

1. **Python-venv:ar och `__pycache__` följer inte med mellan plattformar.**
   `phone-voice/bridge/.venv` och alla `__pycache__` ska INTE kopieras — bygg om
   på plats. Kopiera aldrig `.openclaw` rakt av med rsync.
2. **Två pollers = dubbelt utfört arbete.** Pollern hämtar uppgifter från SCC var
   15:e sekund. Kör aldrig Mac och VPS samtidigt. Flytten är en ren växling:
   `launchctl bootout` på Macen först, starta på VPS:en sedan.
3. **Gatewayn får inte exponeras.** Den binder loopback idag och ska fortsätta
   göra det. Nå den över Tailscale (configen har redan en `tailscale`-sektion,
   `mode: off`) eller SSH-tunnel. Öppna aldrig 18789 mot internet — den har en
   bearer-token men det är inte ett internetgränssnitt.
4. **WhatsApp kan kräva omparning.** Baileys-sessionen ligger i
   `credentials/whatsapp/default/` och överlever normalt en kopiering, men WhatsApp
   kan tvinga omparning när IP och maskin byts. Ha telefonen redo att skanna QR i
   terminalen. Kanalen är låst till `+46737329083` i allowlist.
5. **Pipelinen måste köras PÅ gatewayns maskin.** `prospect_pipeline.py` talar med
   `http://127.0.0.1:18789`. Idag kör Joakim den i sin egen terminal och ser
   korten ticka. Efter flytten sker det över SSH — kör i `tmux` på VPS:en så
   överlever en batch att kopplingen bryts. Det är faktiskt poängen med flytten.

## Ordning

1. Skapa VPS, EU-region. Node 24 via nvm eller nodesource, python 3.12+, tmux,
   Chromium-beroenden för Playwright, Tailscale.
2. `npm i -g openclaw`. Installera inte genom att kopiera `extensions/`.
3. Kopiera: `openclaw.json`, `.env`, `credentials/`, `memory/`, `agents/`,
   `cron/`, `skills/` (utan venv och `__pycache__`), `~/clawd/_agents`.
4. Kör `env.py --check` — den fångar nyckelkonflikter mellan de tre källorna.
5. Byt `apple-calendar` mot `gog-calendar` i `evening-summary`. Lägg Linux-sökvägar
   i `konkurrent_intel.py`. Rätta de tre hårdkodade sökvägarna.
6. systemd-units för gateway och poller, båda `Restart=always`. logrotate på
   gateway-loggen.
7. Växla: stoppa Macens gateway och poller, starta VPS:ens, verifiera att ett
   WhatsApp-meddelande når fram och att pollern plockar en uppgift ur SCC.
8. Kör ett prospektkort hela vägen genom pipelinen som rökprov.
9. Uppdatera `DRIFT.md`: Alex bor inte längre på Macen.

## Rökprov efter flytten

- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/health` → 200 på VPS:en
- WhatsApp-meddelande till Alex ger svar
- En uppgift i SCC plockas av pollern inom 30 sekunder
- `prospect_pipeline.py "<kort>" --no-save` går igenom
- Macen kan stängas utan att något stannar
