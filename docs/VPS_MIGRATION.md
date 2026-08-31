# Alex till VPS (plan 3.4)

**GENOMFÖRD 31 aug 2026 kl 01.15.** Alex bor på Hetzner CPX22 i Helsingfors
(62.238.113.151, Ubuntu 26.04, 2 vCPU / 4 GB / 80 GB, ~25 EUR/mån inkl moms).
Användare `alex`, gateway och poller som systemd user-units med linger påslaget.

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

## Flyttpaketet (byggt 31 aug 00:03 på Macen)

Ligger i `~/alex-vps/` på Joakims Mac:

- `openclaw-core.tgz` (241 MB) — `.openclaw` med config, `.env`, WhatsApp-nycklarna,
  minnet, alla 19 agentkataloger, cron och skills. Utan browsercache, venv:ar,
  `__pycache__`, `node_modules`, loggar och de 437 MB trajektoriefiler som bara är
  uppspelningsdata. Verifierat innehåll: 10 930 poster, noll venv- eller cacheskräp.
- `clawd-agents.tgz` (41 KB) — `~/clawd/_agents`.

**Paketet innehåller nycklar i klartext.** Det ska scp:as direkt till VPS:en och
raderas från båda maskinerna efteråt. Lägg det aldrig i moln eller repo.

Utöver paketet behövs `openclaw-config` klonad på VPS:en till
`/home/alex/openclaw-config` — pollern bor där. Repot är privat
(`github.com/Onepiecedad/openclaw-config`), så VPS:en behöver en deploy-nyckel
eller en klon över HTTPS med token.

Känd kosmetisk detalj: 1 156 `*.trajectory-path.json` pekar på trajektoriefiler
som medvetet lämnades kvar på Macen. De är indexpekare, inget läser dem i drift.

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
   gateway-loggen. Färdiga filer ligger i `openclaw-config/vps/` — kontrollera
   node-sökvägen i unit-filen mot `which openclaw` innan start, systemd läser
   inte `.zshrc` och hittar därför inte nvm.
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


## Vad som faktiskt hände (31 aug, natten)

Flytten tog knappt tre timmar. Planen ovan höll i stort, men fyra saker stämde inte
och är värda att komma ihåg nästa gång något ska flytta.

**Hetzner hade slut på den maskin vi ville ha.** Hela Cost-Optimized-serien (CX/CAX)
var utsåld i alla EU-regioner, både x86 och Arm. Vi landade på CPX22 med 4 GB i
stället för 8, plus 4 GB swap och `vm.swappiness=10`. Motiveringen: forskningsarbetet
är API-anrop, inte lokal Chromium — den enda skillen som drar upp en browser är
`konkurrent_intel`. Hetzner kan skala upp servertypen i efterhand mot en omstart, så
beslutet är reversibelt. **Bevaka minnet vid nästa stora batch.**

**Skriv ingen egen systemd-unit för gatewayn.** `openclaw gateway install` genererar
den själv, korrekt. Min handskrivna unit i `openclaw-config/vps/` är borttagen.
`sudo loginctl enable-linger alex` är däremot nödvändig — utan den dör
användartjänsterna när SSH-sessionen stängs.

**npm hoppar över openclaws installationsskript.** Första `npm i -g openclaw` gav
`4 packages have install scripts not yet covered by allowScripts`, vilket betyder att
de medföljande pluginen aldrig packades upp och att `tree-sitter-bash` inte
kompilerades. Kör med flaggan:

    npm install -g --allow-scripts=openclaw,@google/genai,protobufjs,tree-sitter-bash openclaw@<version>

WhatsApp-pluginet ligger utanför paketet och installeras separat med
`openclaw plugins install clawhub:@openclaw/whatsapp`. **WhatsApp-sessionen överlevde
flytten utan omparning** — Baileys-nycklarna i `credentials/whatsapp/default/` räckte,
telefonen behövde aldrig skanna någon QR.

**Enhetsparningen låste sig i ett moment 22.** `paired.json` hade enheten registrerad
med `platform: darwin`. När CLI:t anmälde sig som `linux` läste openclaw det som en
metadataändring och krävde godkännande — men `openclaw devices approve` kräver
`operator.admin`, som den väntande enheten inte har förrän ändringen godkänts. Lösningen
var att stoppa gatewayn, sätta `platform` till `linux` direkt i
`~/.openclaw/devices/paired.json` (samma deviceId, samma nyckel, samma token) och starta
om. Backup ligger som `paired.json.macos`. Symptomet att känna igen:
`Capability: pairing-pending` och `missing scope: operator.admin`.

**Alex vaknade utan identitet.** Första WhatsApp-meddelandet efter flytten fick svaret
"jag vet inte riktigt vem jag är än — vem är du?". Orsaken: agenterna `main` och
`skyland` har `~/clawd` som workspace, alltså katalogens ROT, där `IDENTITY.md`,
`SOUL.md`, `MEMORY.md`, `AGENTS.md`, `USER.md` och `memory/` ligger. Flyttpaketet tog
bara `~/clawd/_agents` (underagenternas kataloger) eftersom `~/clawd` var 1,2 GB — men
det som gjorde den stor var `projects/`, inte identiteten. Utan workspace skapar
openclaw en tom bootstrap med mall-`IDENTITY.md` och `BOOTSTRAP.md`, och agenten börjar
fråga vem den ska vara.

Rätt paket är `~/clawd` **utan** `projects/` och `out/`: 10 MB i stället för 1,2 GB.
Kontroll efter uppackning: `IDENTITY.md` ska vara ~7,6 kB, inte mallens 1,3 kB, och
`memory/` ska ha ett trettiotal filer. Bootstrap-katalogen sparades som
`~/clawd.bootstrap`.

Regeln att ta med sig: **kontrollera agenternas `workspace`-sökvägar i openclaw.json
innan du bestämmer vad som ska flytta.** Att kopiera `_agents` är inte samma sak som att
kopiera arbetsytan.

**En praktisk sak:** kör inget av det här som root. En root-session installerade en
andra gateway på `/root/.config/systemd/user/` med tom konfiguration; den är borttagen
och `/root/.openclaw` ligger som `.skrot`.

`env.py` letar numera efter repot på både `~/Developer/openclaw-config` (Macen) och
`~/openclaw-config` (VPS:en).

### Verifierat efter flytten

- `openclaw gateway status`: `Connectivity probe: ok`, `Capability: admin-capable`
- 10 plugin laddade, inklusive whatsapp; kanalen lyssnar på +46737329083
- Alex svarar på WhatsApp från telefonen med Macen avstängd, med rätt identitet laddad
- `systemctl --user is-active scc-poller openclaw-gateway`: active, active
- Pollern loggar `[poller] startad · SCC=https://scc.skylandai.se · var 15s`
- `env.py --check`: 0 konflikter
- SCC nåbar från servern: HTTP 200

### Kvar att göra

- Tailscale, så gatewayns dashboard går att nå utan SSH-tunnel. Porten är fortsatt
  loopback-bunden och brandväggen släpper bara in SSH.
- `plugins.allow` i openclaw.json (gatewayn varnar att den auto-laddar whatsapp utan
  explicit tillit).
- Köra ett prospektkort hela vägen genom pipelinen på servern som skarpt rökprov.
- Radera `~/alex-vps/*.tgz` på Macen och `~/*.tgz` på servern — de innehåller nycklar.
- Macens launchd-jobb ligger som `.plist.disabled`. Radera dem när flytten känns stabil.

## Vad första skarpa WhatsApp-testet avslöjade (31 aug 02.00)

Joakim testade Alex från telefonen med ett meddelande som frågade om minne, en
SCC-siffra och vilken maskin den kör på. Fyra saker föll ut.

**Identiteten fungerar.** Alex svarar som sig själv, känner igen Joakim och håller tonen.

**Minnet har ett hål, och Alex var ärlig om det.** "Hittar inga minnesfiler för 29–30
augusti." Korrekt — de två kvällarnas arbete gjordes genom Claude, inte genom Alex, så
ingenting hamnade i Alex dagsloggar. Värt att veta: Alex vet inte vad vi gjorde med
systemet den här helgen om ingen berättar det.

**Alex reparerade sig själv, vilket är bra och ett problem.** `scc.sh` kraschade på att
`jq` saknades på Ubuntu. Alex skrev om skriptet till Python (`scc.py`, 9,4 kB) och fick
fram rätt siffra: 25 beauty-kort i New Prospect, plus 7 som flyttats till Contacted i
Skuggveckan — alltså kvällens 32. Omskrivningen var bra och ligger nu i repot. Men den
skrevs direkt på servern och fanns ingenstans annars, vilket är precis den drift fas 1
handlade om. **Nu när Alex är alltid-på kommer det här att hända igen.** Vi behöver en
rutin som fångar skillnaden mellan live-skills på VPS:en och repot.
`jq` är också installerat, eftersom `dm_pipeline.sh` fortfarande använder det.

**403:an mot Bland AI var varken nyckeln eller IP:n.** Cloudflare svarar med felkod 1010
på urllibs standard-User-Agent. Verifierat från VPS:en: samma anrop, samma nyckel —
`python-urllib` utan UA ger 403, med en satt UA ger 200, och `curl` ger 200 hela vägen.
Alex hade skrivit egna Python-versioner av samtalsskripten som gick i den fällan; de
ligger nu i `_alex-python-403/` och shell-versionerna gäller. `prospect_pipeline.http()`
sätter numera alltid en egen User-Agent.

De tre bland-skripten läste dessutom bara `BLAND_API_KEY` ur skalets miljö, vilket inte
finns under systemd. De laddar nu nyckeln via `env.py` som resten sedan fas 1. Rökprov
från VPS:en: `bland.sh list` svarar 200.

**En fråga Alex duckade:** "vilken maskin kör du på" besvarades med programversion och
modellnamn, inte med värdnamn. Den gissade inte fel, men den kollade inte heller. Värt
att hålla ögonen på när den ska börja agera självständigt.

## Kontoret genom gatewayn över Tailscale (31 aug, förmiddag)

Efter flytten föll Kontoret tillbaka till server-läge: webbläsaren pratade med
`ws://127.0.0.1:18789`, och gatewayn bor inte längre på samma maskin som webbläsaren.

**Så här ser vägen ut nu.** Tailscale på VPS:en (`alex`, 100.97.160.13) och på Joakims
Mac och telefon. `gateway.tailscale.mode = "serve"` gör att openclaw exponerar gatewayn
som `https://alex.tail8a8e79.ts.net` — bara inom tailnätet, med TLS, utan att en enda
port öppnas mot internet. Gatewayn binder fortsatt loopback. `sudo tailscale set
--operator=alex` krävs för att gatewayn ska få styra `tailscale serve` utan root.

**Två fällor på vägen dit.**

1. **Renders miljövariabler nådde aldrig vite-bygget.** `VITE_GATEWAY_TOKEN` var
   deklarerad som `ARG` i `backend/Dockerfile`, de nya adresserna inte — och Render
   skickar bara in env som build-args om de deklarerats. Bundlen fortsatte peka på
   localhost hur rätt värdena än stod i dashboarden. **Varje ny `VITE_`-variabel måste
   få en `ARG`-rad i Dockerfilen.**

2. **Gatewayn avvisade kontrollgränssnittet** med `control ui requires device identity`
   och WS-kod 1008. Logiken i `evaluateMissingDeviceIdentity` släpper in ett
   kontrollgränssnitt utan parad enhetsnyckel bara om klienten har enhetsidentitet,
   kommer via trusted-proxy-auth, har enhetsauth avstängd, eller **är lokal**. Över
   tailnätet är den inte lokal — tidigare släpptes den in som `localhost`.

   Trusted-proxy testades och fungerar inte här: den är ömsesidigt uteslutande med
   delad token, och token behövs av pipelinen, pollern och alla skills. Gatewayn
   vägrade starta med båda satta.

   Vald lösning: `gateway.controlUi.dangerouslyDisableDeviceAuth = true`.
   **Vad det faktiskt innebär:** gatewayn kräver fortfarande bearer-token och är bara
   nåbar inifrån tailnätet. Det som faller bort är kravet att webbläsaren har en parad
   enhetsnyckel. Perimetern är alltså tailnät plus token i stället för enhetsnyckel.
   Med tre enheter i tailnätet, alla Joakims, är det en rimlig avvägning — men det är
   en medveten sänkning och ska byggas bort, se nedan.

**Att bygga bort det:** SCC-frontenden behöver egen enhetsidentitet — generera nyckelpar,
para mot gatewayn, spara i webbläsaren. Då kan `dangerouslyDisableDeviceAuth` slås av
igen. Ligger som ärende i handovern.

**Sidofynd:** minnespanelen (`getMemoryEntries`, `searchMemory`) hade
`http://127.0.0.1:3001` hårdkodat och har därför aldrig fungerat i produktion, bara i
lokal dev. Rättat till samma origin.


## Omstartstest 31 aug — godkänt

`sudo systemctl reboot` på VPS:en. Uppe igen på under en minut. Gateway (nytt pid),
poller (ny worker), Tailscale och `tailscale serve` startade av sig själva tack vare
linger plus `enabled`. WhatsApp anslöt utan omparning, alla tio plugin laddade, swappen
orörd. Ingen manuell åtgärd.

Detaljen att känna till: gatewayns loggar skriver openclaw till `/tmp`, som töms vid
omstart. Vill man ha dem kvar över omstarter behöver logsökvägen flyttas — pollerns
loggar ligger redan i `~/.openclaw/logs` och roteras av logrotate-filen i `vps/`.
