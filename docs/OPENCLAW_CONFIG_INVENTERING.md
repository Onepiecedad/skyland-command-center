# Inventering av `openclaw-config` (plan 3.5)

**Gjord 31 augusti 2026.** Underlaget är hämtat, inte gissat: filerna i
`~/Developer/openclaw-config` på Macen, `~/.openclaw` och `~/openclaw-config` på
VPS:en (62.238.113.151), systemd-enheterna där, `launchctl list` på Macen och
cron-tabellen i `~/.openclaw/state/openclaw.sqlite`.

**Uppdaterad samma kväll:** Joakim beslutade om punkt 1, 2 och 4. De är utförda och
markerade ✅ nedan. Punkt 3 (verktygen) är en lista att ta ställning till. Ingenting
är raderat — allt som flyttats ligger under `_arkiv/`.

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

### F2 ✅ ÅTGÄRDAT — Två schemalagda jobb kraschade varje gång de kördes

| Jobb | Schema | Fel | I rad |
|---|---|---|---|
| Kvällssammanfattning | 21:00 dagligen | `Exec failed: run himalaya envelope` i skillen `apple-calendar` | 7 |
| Kundvakt — veckorapport | fre 15:00 | `All models failed: kimi-k2.5 timeout, gemini-2.5-flash timeout` | 6 |

Kvällssammanfattningen anropar `himalaya` och `apple-calendar` — verktyg som bara
finns på Macen. Jobbet flyttade med till Linux men verktygen gjorde det inte.

**Gjort:** kvällssammanfattningen läser numera `GET /api/v1/reports/digest` i SCC,
samma siffror som morgonmejlet. Inga lokala mejl- eller kalenderverktyg alls.

Morgonbriefen (`proactive-checkin`) hade samma sjukdom fast tystare: dess
`check_email.sh` skrev "himalaya not installed" och avslutade med exit 0, så
jobbet såg lyckat ut medan det var blint. Den läser nu samma endpoint, och
wrappern ligger i skill-mappen i stället för på en absolut sökväg till en viss
dator. Det var hårdkodningen `/Users/onepiecedad/...` som dödade signalen vid
flytten.

**Kvar:** Kundvakten. Kör den manuellt en gång för att se om timeouten är
modellen eller nätet.

### F3 — Inget schemalagt jobb har kört sedan flytten

Senaste riktiga körningen i `cron_run_logs` är **30 augusti 11:19**. Jobben som
skulle gått 02:00 och 07:00 den 31:a finns inte i loggen. Enda körningarna efter
flytten är ett tillfälligt femminutersjobb som lades till 08:55 och togs bort
09:29 den 31:a.

**Rekommendation:** verifiera i morgon bitti att `Skyland morgonbrief`,
`Morning check-in` och `Skyland nattliga leads` faktiskt fyrar. Om de inte gör
det är schemaläggaren, inte jobben, det som är trasigt.

### F4 ✅ ÅTGÄRDAT — Macen körde fortfarande ett jobb varje morgon

`com.skyland.daily-ops` är fortfarande laddad i launchd och skrev senast
**31 augusti 05:05** till `openclaw-config/runs/inbox/2026-08-31.json`. Planen
säger att Macens jobb är avstängda; det gäller pollern (`.plist.disabled`) men
inte det här. Även `ai.skyland.scc-frontend` kör (pid 714) och
`se.skyland.rostpennan` kraschar i loop (exitkod -11).

**Gjort:** avstängd. Jobbet kom från V1-eran och har producerat tomma briefer
sedan 18 augusti — noll leads, noll utkast — och mejlade dem till
`onepiecedad@localhost`, alltså till ingen. Den riktiga prospekteringen går genom
SCC. Även `com.skyland.gateway-err-rotation` är avstängd; den roterade en logg för
Macens gateway, som inte finns längre.

`se.skyland.rostpennan` kraschar i loop på Macen (exitkod -11). Den hör inte till
det här bygget och är orörd, men den ligger och startar om sig själv.

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

Nio verktyg är installerade live men saknas i repot. Alla har samma tidsstämpel
(30 aug 22:33), alltså kom de med i flyttpaketet från Macen utan att någonsin ha
speglats till repot. Ingen av dem används av säljflödet.

| Verktyg | Vad det gör | Läge | Rekommendation |
|---|---|---|---|
| `competitive-intelligence-market-research` | Konkurrentanalys för B2B SaaS, 24 färdiga scenarier | **Märkt `always: true`** — laddas in i varje samtal Alex har, oavsett ämne, och kostar tokens varje gång | **Avinstallera.** Enda always-on-skillen på servern, och den handlar om ett annat kundsegment än vårt |
| `nano-banana-pro` | Bildgenerering via Gemini 3 Pro Image | **Fungerar inte:** kräver `uv` (saknas) och `GEMINI_API_KEY` (saknas) | Avinstallera, eller installera beroendena om vi vill ha bildgenerering. Just nu är den bara en kuliss |
| `voice-call-verify` | Testar röstsamtalsflödet | **Fungerar inte:** kräver skillen `voice-call`, som inte finns. Vi ringer via `phone-calls-bland` | Avinstallera |
| `walkie-talkie-mode` | Röst-till-röst på WhatsApp: transkriberar ljudmeddelanden och svarar med tal | **Fungerar inte:** ingen TTS-motor på servern (`say`, `espeak`, `piper` saknas alla) | Behåll bara om du vill kunna prata med Alex i stället för att skriva. Då krävs en TTS-motor installerad, annars avinstallera |
| `news-aggregator-skill` | Nyhetssvep från Hacker News, GitHub Trending, Product Hunt, 36Kr, Tencent, WallStreetCN, V2EX, Weibo | Funkar (behöver `requests`, `beautifulsoup4`) | Avinstallera. Kinesisk tech- och finansnyhetsbevakning har inget med tatuerings- och skönhetskliniker i Göteborg att göra |
| `reddit-scraper` | Läser och söker Reddit via old.reddit.com, skrivskyddat | Funkar | Avinstallera om du inte använder den manuellt. Inget i flödet anropar den |
| `lyra-prompt-optimizer` | Skriver om prompter enligt en egen metodik | Funkar | Behåll bara om **du** använder den. Alex behöver den inte |
| `seo-competitor-analysis` | SEO-analys av konkurrenters sajter: nyckelord, länkar, innehåll | Funkar | Gränsfall. Vi säljer till kliniker och tittar redan på deras sajter via `konkurrent_intel.py`. Behåll om du vill kunna göra en SEO-titt på ett prospekt, annars bort |
| `social-card-gen` | Genererar inlägg för sociala medier | Funkar | Överlappar `ad-factory`. Avinstallera om inte du använder den |

Sammanfattat: tre av nio är trasiga på servern och kan inte fungera, tre är
irrelevanta för det vi gör, och tre är smaksak. Den enda som kostar något varje
dag är `competitive-intelligence-market-research`, eftersom den laddas i varje
samtal.

**Vad som ska hända med dem du behåller:** speglas in i repot, annars försvinner
de vid en ominstallation.

### Beslut 1 sep 2026 (Joakim)

Åtta av nio bort: de fyra självklara (competitive-intelligence, nano-banana-pro,
voice-call-verify, news-aggregator) plus reddit-scraper, lyra-prompt-optimizer,
seo-competitor-analysis och social-card-gen — de fyra sista arkiveras, inte
raderas, eftersom de kan bli aktuella framöver. **walkie-talkie-mode behålls**
(kräver TTS-motor på VPS:en innan den fungerar).

Utfört på Macen 1 sep: alla åtta flyttade till `~/.openclaw/skills/_archived/`
med README som listar vad som ligger där och varför (sex fanns redan där som
exakta dubbletter — diff-verifierade, lagda i `_to_delete_dubbletter_2026-09-01/`).
VPS-körningen: se kommandoblock i `docs/HANDOVER_2026-09-01.md`.

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

---

## 7. Vad som faktiskt utfördes 31 aug

| Åtgärd | Var |
|---|---|
| Kvällssammanfattningen läser SCC | `skills/evening-summary/SKILL.md` |
| Morgonbriefen läser SCC, wrappar i skill-mappen | `skills/proactive-checkin/` |
| Ny rapportendpoint som båda läser | `backend/src/routes/reports.ts` → `GET /api/v1/reports/digest` |
| Bokningar med i digesten | `backend/src/services/dailyDigest.ts` |
| `com.skyland.daily-ops` avstängd | Macens LaunchAgents, plist omdöpt till `.disabled` |
| `com.skyland.gateway-err-rotation` avstängd | samma |
| 49 specdokument, `schemas`, `examples`, `business`, `ops`, `supabase`, 49 V1-skript flyttade | `_arkiv/spec-v1/` |
| `runs/` (4 014 filer) och `logs/` (4,1 MB) flyttade och gitignorerade | `_arkiv/output-2026-08-31/` |
| Macens tre plist-filer arkiverade | `_arkiv/mac-launchd/` |
| `cron/jobs.json` arkiverad, README pekar på sqlite-tabellen | `cron/README.md` |

Rapportendpointen svarar 404 tills SCC deployats. Wrappen degraderar då snyggt
med `STATUS: unavailable` i stället för att fälla jobbet, vilket är testat mot
prod.
