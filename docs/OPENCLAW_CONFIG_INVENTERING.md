# Inventering av `openclaw-config` (plan 3.5)

**Gjord 31 augusti 2026.** Underlaget är hämtat, inte gissat: filerna i
`~/Developer/openclaw-config` på Macen, `~/.openclaw` och `~/openclaw-config` på
VPS:en (62.238.113.151), systemd-enheterna där, `launchctl list` på Macen och
cron-tabellen i `~/.openclaw/state/openclaw.sqlite`.

**Joakim godkänner listan innan något flyttas eller raderas.** Ingenting i det här
dokumentet är utfört.

---

## 1. Det viktigaste först: fyra fynd som inte kan vänta

### F1 — Repots master-config skulle sänka Alex om den deployades

`openclaw.json` i repot är fortfarande formad efter Macen. Jämfört med den som
faktiskt kör på VPS:en skiljer den på tre ställen som spelar roll:

| Nyckel | Repot | Live på VPS |
|---|---|---|
| `agents.defaults.workspace` | `/Users/onepiecedad/clawd` | `/home/alex/clawd` |
| `gateway.tailscale.mode` | `off` | `serve` |
| `hooks.transformsDir` | `/Users/onepiecedad/.openclaw/hooks/transforms` | `/home/alex/.openclaw/hooks/transforms` |
| `agents.list` | 10 agenter | 11 agenter |

En körning av `deploy_openclaw_config.sh` skulle alltså peka arbetsytan på en
katalog som inte finns och stänga av Tailscale — vilket tar ner Kontorets väg in
till gatewayn. Skriptet pekar dessutom bara på Mac-sökvägar; det finns ingen
deployväg till VPS:en alls.

**Rekommendation:** gör om repo-configen till VPS-formad (Linux-sökvägar,
`tailscale.mode = "serve"`), och lägg deployen över SSH. Tills dess: kör inte
skriptet.

### F2 — Två schemalagda jobb kraschar varje gång de körs

| Jobb | Schema | Fel | I rad |
|---|---|---|---|
| Kvällssammanfattning | 21:00 dagligen | `Exec failed: run himalaya envelope` i skillen `apple-calendar` | 7 |
| Kundvakt — veckorapport | fre 15:00 | `All models failed: kimi-k2.5 timeout, gemini-2.5-flash timeout` | 6 |

Kvällssammanfattningen anropar `himalaya` och `apple-calendar` — verktyg som bara
finns på Macen. Jobbet flyttade med till Linux men verktygen gjorde det inte.

**Rekommendation:** stäng av Kvällssammanfattningen tills den skrivits om mot
mejlet i SCC i stället för himalaya, och kör Kundvakten manuellt en gång för att
se om timeouten är modellen eller nätet.

### F3 — Inget schemalagt jobb har kört sedan flytten

Senaste riktiga körningen i `cron_run_logs` är **30 augusti 11:19**. Jobben som
skulle gått 02:00 och 07:00 den 31:a finns inte i loggen. Enda körningarna efter
flytten är ett tillfälligt femminutersjobb som lades till 08:55 och togs bort
09:29 den 31:a.

**Rekommendation:** verifiera i morgon bitti att `Skyland morgonbrief`,
`Morning check-in` och `Skyland nattliga leads` faktiskt fyrar. Om de inte gör
det är schemaläggaren, inte jobben, det som är trasigt.

### F4 — Macen kör fortfarande ett jobb varje morgon

`com.skyland.daily-ops` är fortfarande laddad i launchd och skrev senast
**31 augusti 05:05** till `openclaw-config/runs/inbox/2026-08-31.json`. Planen
säger att Macens jobb är avstängda; det gäller pollern (`.plist.disabled`) men
inte det här. Även `ai.skyland.scc-frontend` kör (pid 714) och
`se.skyland.rostpennan` kraschar i loop (exitkod -11).

**Rekommendation:** bestäm om daily-ops ska leva vidare på Macen eller flytta till
VPS:en. Två maskiner som båda skriver in i samma repo-katalog är precis den drift
vi håller på att bygga bort.

---

## 2. Vad som faktiskt kör (LIVE — rör inte utan att veta varför)

| Sökväg | Roll | Bevis |
|---|---|---|
| `skills/` (38 skills) | Speglas till `~/.openclaw/skills` på både Mac och VPS. `scc-crm` är kärnan i pipelinen. | Alla 36 filer i `scc-crm` identiska mellan repo, Mac och VPS så när som på en sökvägsrad i `references/sajtandringar.md` (`/Users/onepiecedad` → `/home/alex`, omskriven vid flytten) |
| `scripts/scc_poller.py` | Pollern som hämtar körningar från SCC. | `scc-poller.service` på VPS: `ExecStart=/usr/bin/python3 /home/alex/openclaw-config/scripts/scc_poller.py --interval 15`, aktiv |
| `scripts/env.py` | Nyckelhämtning för skills och skript. | Anropas från `phone-calls-bland`, `prospect_pipeline.py`, `post-call-analyzer.py` |
| `openclaw.json` | Master för gatewaykonfigurationen — **men Mac-formad, se F1.** | Live-kopian ligger i `~/.openclaw/openclaw.json` på VPS |
| `vps/` | `scc-poller.service`, logrotate, README för VPS-uppsättningen. Skriven 30 aug. | Enheten på VPS är kopian av den här |
| `.env` | Hemligheter för deployrenderingen. Gitignorerad. | — |

## 3. Arkiv (behåll, men inget läser dem)

| Sökväg | Vad | Varför arkiv |
|---|---|---|
| 49 `*_V1.md` i roten | Specerans dokument: `ARCHITECTURE_V1`, `ORCHESTRATOR_SPEC_V1`, `APPROVAL_*`, `V1_*` m.fl. | Nästan alla från 22 mars. Beskriver ett agentbygge som SCC ersatte. Läsvärda som historik, inga referenser i kod |
| `schemas/` (33 filer) | JSON-scheman för spec-eran | Ingen kod validerar mot dem |
| `examples/`, `business/`, `ops/`, `supabase/` | Exempeldata och SQL från mars | Supabase-katalogen är särskilt vilseledande: den riktiga databasen ligger i SCC-repot |
| `agents/_archived-2026-08-11/` | Två avvecklade agenter | Redan märkta som arkiv |
| `Skyland_Core_V1_Backlog_Antigravity.md` (29 kB) | Gammal backlog | Ersatt av `docs/BACKLOG_2026-08-31.md` i SCC |
| `openclaw-cold-outreach-playbook.docx` | Playbook från 6 mars | Innehållet lever i `scc-crm`-doktrinen nu |

## 4. Dött eller felplacerat

| Sökväg | Vad | Förslag |
|---|---|---|
| `runs/` — **4 014 filer, 19 MB** | Körningsoutput: discovery, briefings, inbox, scoring, approvals. Fylls fortfarande på av Macens daily-ops (F4) | Output hör inte hemma i en konfigurationsrepo. Gitignorera och flytta till `~/clawd/out/` |
| `logs/` — 4,1 MB | `scc_poller.launchd.err.log` ensam 2,6 MB, från Macens poller som inte längre kör | Ta bort; loggarna finns i journalctl på VPS:en nu |
| `launchd/` (3 plist) | Macens jobb. Pollern är avstängd, daily-ops kör (F4), logrotationen är ersatt av logrotate på VPS | Behåll bara det som Macen faktiskt ska köra efter beslutet i F4 |
| `cron/jobs.json` | **Läses inte längre av någon.** OpenClaw flyttade cron till `~/.openclaw/state/openclaw.sqlite`; repo-filen listar 6 jobb, databasen har 9 rader med andra av/på-lägen | Märk som arkiv, eller ersätt med ett skript som exporterar sanningen ur sqlite |
| `deploy_openclaw_config.sh` | Deployar till Mac-sökvägar, och cron-delen skriver till en fil ingen läser | Skriv om mot VPS:en (F1) eller pensionera |
| `agents/produce-package/__pycache__/`, `scripts/__pycache__/` | Bytekod i git | Gitignorera |

## 5. Skills som bara finns på VPS:en

Nio skills är installerade live men finns inte i repot:
`competitive-intelligence-market-research`, `lyra-prompt-optimizer`,
`nano-banana-pro`, `news-aggregator-skill`, `reddit-scraper`,
`seo-competitor-analysis`, `social-card-gen`, `voice-call-verify`,
`walkie-talkie-mode`.

De kom in via clawdhub efter att repot senast synkades. Ingen av dem används av
pipelinen. **Rekommendation:** speglas in i repot om de ska överleva en
ominstallation, annars avinstalleras — men bestäm, låt dem inte ligga i limbo.

## 6. Förslaget: ett ställe för agentkonfiguration

Ordningen som gör de här fynden omöjliga att upprepa:

1. **Repot är master för det som ska överleva en ominstallation:** `openclaw.json`,
   `skills/`, `scripts/`, `vps/`. Inget annat.
2. **Repot är VPS-format**, inte Mac-format. Macen är numera en klient, inte en
   runtime.
3. **Output och loggar ligger utanför repot.** `runs/` och `logs/` gitignoreras.
4. **Spec-eran flyttas till `arkiv/`** i ett svep, så roten visar det som lever.
5. **Cron exporteras ur sqlite till repot** av ett skript, i stället för att en
   handskriven `jobs.json` låtsas vara sanningen.
6. **En deploy över SSH** som kan köras om utan att någon behöver komma ihåg
   ordningen.

Steg 1–4 är flytt och gitignore. Steg 5–6 är två små skript. Ingenting av det
kräver att Alex står stilla.
