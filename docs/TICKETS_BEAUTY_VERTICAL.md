# BV — Beauty-vertikalen (estetikkliniker) — Tickets

> Ny gren av prospekteringsmaskinen: samma pipelines, ny nisch. Underlag:
> `skylandbeautygtmplanv2.md` (provisionsmodell v2: 15–20 % på paketvärde,
> golv 1 000 kr, trigger vid betalt paket).
>
> **Princip: forka INTE skripten.** Allt nischspecifikt (söktermer, scoring,
> research-brief, DM-doktrin, pipeline-val) flyttas till en vertikal-config som
> pipelines laddar via `--vertical`. Tattoo blir default-vertikalen med exakt
> dagens beteende — noll regression. Nästa nisch efter beauty kostar då bara
> en config-fil, vilket också är exakt vad Prospector-produkten (Malte-spåret)
> behöver.
>
> Konventioner: pipelines i `openclaw-config/skills/scc-crm/scripts/` (synkas
> till `~/.openclaw/skills/`), SCC-routes under `backend/src/routes/`,
> migrations `ticketNN_*.sql`, commit-stil `feat(scope): beskrivning`.
> Synka ALDRIG skript medan batch kör. Gateway-omstart efter skilländringar.
>
> **Ingår INTE i denna fas:** attribution till *betalt paket* (v2-modellens
> faktureringsgrund) och beauty-partneravtalet. Prospektering → skickbart DM
> räcker för outreach; attributionen måste finnas innan första piloten signas
> — eget spår, egen tickets-fil.

## User story

> **Som** operatör (Joakim)
> **vill jag** kunna ge Alex ett enda kommando — *"hitta de 10 mest optimala
> klinikerna i Göteborgsområdet, gör research, berika korten och skapa DM:s"*
> **så att** jag efter körningen har en färdig, kvalitetsgrindad utskickskö i
> CRM:et under en egen Beauty-vy — utan att tattoo-spåret påverkas och utan
> att jag rör något manuellt före granskning/utskick.

**Acceptans (hela storyn):**
- CRM:et har en pipeline-tabb "Prospecting (Beauty)"; växling mellan tattoo
  och beauty är ett klick. Tattoo-korten syns aldrig i Beauty-vyn och tvärtom.
- Ett Alex-kommando kör hela kedjan: discover (beauty-söktermer, exkludering
  av frisör/naglar/spa) → dedup → berikning (paket-/behandlingssignaler) →
  beauty-scoring → topp N → research (IVO, prislista, behandlingsmix) →
  validerat DM per kort.
- Varje DM passerar beauty-grindarna: aldrig "botox"/läkemedelsvarumärken,
  aldrig resultatlöften, paket-/provisionspitchen i uppföljningen, samma
  AI-markörgrindar som tattoo.
- Tattoo-regression: `discover_pipeline.py "tatuerare" "Borås" --dry-run` och
  en `dm_pipeline.sh`-körning på ett befintligt tattoo-kort beter sig exakt
  som före ändringarna.

## Beroendekarta

```
BV-1 (vertikal-config) ──► BV-3 (discover beauty) ──► BV-4 (scoring)
        │                                                  │
        ├──► BV-5 (research-brief)                         │
        ├──► BV-6 (DM-doktrin + grindar)                   │
        │                                                  ▼
BV-2 (SCC-pipeline) ─────────────────────────────► BV-7 (Alex-orkestrering)
                                                           │
                                                           ▼
                                                   BV-8 (pilotkörning)
```

BV-1 är kritisk väg. BV-2 kan gå parallellt. BV-8 är grinden mot skarpt utskick.

---

## BV-1 — Vertikal-config + loader

**Fas:** BV · **Prio:** P0 · **Blockerar:** allt

Flytta det nischspecifika ur skriptkoden till data. En katalog
`openclaw-config/skills/scc-crm/verticals/` med `tattoo.json` och
`beauty.json`; alla tre pipelines får `--vertical <namn>` (default `tattoo`).

**Filer**
- `openclaw-config/skills/scc-crm/verticals/tattoo.json` (ny) — dagens beteende, kodifierat.
- `openclaw-config/skills/scc-crm/verticals/beauty.json` (ny)
- `scripts/discover_pipeline.py`, `scripts/prospect_pipeline.py`, `scripts/dm_pipeline.sh`, `scripts/prospect_batch.py` (ändra) — läs config, ta `--vertical`.

**Config-fält (minimum)**
- `niche_tag` ("niche:tattoo" / "niche:beauty"), `pipeline_name` (exakt namn, se BV-2).
- `search_terms[]` (tattoo: `["tatuerare"]`; beauty: se BV-3).
- `name_stopwords[]` för dedup-normalisering (tattoo: dagens `ab|hb|tattoo|tatuering|studio|ink`; beauty: `klinik|clinic|skin|beauty|estetik|laser|hud|salong`).
- `exclude_patterns[]` (kategorier/titlar som filtreras bort vid discover).
- `site_signals{}` — regexar för sajtskrapan (beauty: paket/injektion/laser, se BV-3).
- `scoring` — modellnamn + vikter (se BV-4).
- `research_brief` — sökväg till brief-mall + lista över obligatoriska sektioner (validate_research läser HÄRIFRÅN, inte hårdkodat).
- `dm_style` — sökväg till stilguide + grind-profil (se BV-6).

**Rättas samtidigt (buggar som annars biter beauty)**
- `get_stage()` i discover matchar `"Prospecting" in p["name"]` — träffar FEL
  pipeline när det finns två. Byt till exakt match mot `pipeline_name` ur config.
- Research-briefen hårdkodar `Ort: Göteborg/Mölndal` — ta orten från kortets
  `custom.area` i stället (fel redan idag för Kungsbacka/Alingsås-kort).

**Klart när**
- `--vertical tattoo` (och utelämnad flagga) ger bitidentiskt beteende mot idag: samma tags, samma scoring, samma brief, samma DM-grindar.
- `--vertical beauty` laddar beauty.json utan kodändringar.
- Okänt vertikalnamn = tydligt fel, exit ≠ 0 (Alex-regeln: rapportera och stanna).

---

## BV-2 — SCC: pipeline "Prospecting (Beauty)"

**Fas:** BV · **Prio:** P0 · **Kan gå parallellt med BV-1**

Egen pipeline i SCC med samma stages som Prospecting (Agency). Frontendens
pipeline-tabbar plockar upp den automatiskt — det ÄR vyväxlingen.

**Filer**
- `database/migrations/ticketBV2_beauty_pipeline.sql` (ny) — idempotent seed
  (`INSERT ... ON CONFLICT DO NOTHING`-mönster) av pipeline + stages, ELLER
  engångsskapande via `POST /api/v1/pipelines` — välj samma väg som Agency-pipelinen skapades.

**Innehåll**
- Pipeline `Prospecting (Beauty)`, stages identiska med Agency (New Prospect → … → Outreach Ready → Contacted → Replied → …). Samma stage-namn = auto-loggen vid drag till Contacted och Contacted→Replied-flytten från IG-webhooken fungerar utan ändring.
- `is_default` förblir Agency (tattoo är fortfarande huvudspåret).
- Verifiera i frontend: fritextsök, Score/A–Ö/Ort-sortering, tier-filter och kostnadschipet fungerar i nya tabben (allt är per-pipeline redan — detta är en kontroll, inte ett bygge).

**Klart när**
- Tabben syns, är tom, och ett testkort i den syns ALDRIG under Agency-tabben.
- Drag till Contacted på ett beauty-kort auto-loggar öppnaren precis som för tattoo.

---

## BV-3 — Discover för beauty (sök, filter, sajtsignaler)

**Fas:** BV · **Prio:** P0 · **Kräver:** BV-1, BV-2

"Skönhetsklinik" på Maps är sörja — frisörer, naglar, spa. Beauty-discover
kräver flera söktermer, sammanslagning och ett exkluderingsfilter.

**Filer**
- `scripts/discover_pipeline.py` (ändra) — multi-term-sök + exkludering + nya sajtsignaler, allt styrt av config.
- `verticals/beauty.json` (fyll i)

**Innehåll**
- `search_terms`: `laserklinik`, `estetisk klinik`, `hudvårdsklinik`, `laser hårborttagning`, `skönhetsklinik` — alla körs mot orten (Apify tar redan `searchStringsArray`, en körning), resultaten slås ihop och dedup:as INNAN CRM-dedup (samma klinik träffas av flera termer).
- `exclude_patterns` mot Maps `categoryName`/titel: `frisör|barber|nagel|nails|spa|massage|hårsalong|fransar|brow`. Exkluderade rader listas i utskriften som `– filtrerad: <namn> (<kategori>)` — inga tysta bortfall.
- Sajtskrapan får beauty-signaler (utöver dagens mejl/IG/bokningsflöde), sparas i `custom`:
  - `sells_packages` — `paket|kur|serie|klippkort|behandlingsserie|[0-9]+ ?(behandlingar|ggr)` på sajten/prislistan. **Viktigaste signalen** (GTM v2: provision beräknas på paketvärde).
  - `treatments_regulated` — `botox|botulinum|filler|profhilo|skinbooster|prp|injektion` (reglerat: får ej annonseras direkt).
  - `treatments_free` — `laser|hårborttagning|hudvård|microneedling|frekvens|ipl` (fritt annonserbart).
- Dedup-normaliseringen använder `name_stopwords` ur config (BV-1) så "Alma Laserkliniken" vs "Alma Laser Clinic AB" dedup:ar rätt.
- Kort skapas i `Prospecting (Beauty)` / New Prospect med tags `niche:beauty, area:<ort>, prospect, tier:<X>, enriched`.

**Klart när**
- `discover_pipeline.py --vertical beauty "Göteborg" --dry-run` ger en lista där stickprov visar: inga frisörer/nagelsalonger, paket-/behandlingsflaggor satta där sajten stödjer det.
- Skarp körning skapar kort ENBART i Beauty-pipelinen.

---

## BV-4 — Beauty-scoring (paketviktad, GTM v2)

**Fas:** BV · **Prio:** P0 · **Kräver:** BV-3

Tattoo-scoringen belönar manuellt bokningsflöde (friktion = möjlighet). För
beauty är det fel modell: värdet sitter i paketförsäljning och fritt
annonserbar behandlingsmix. Ny formel, samma 100-poängsskala och tier-gränser
(A ≥ 85, B ≥ 70) så frontendens tier-filter fungerar oförändrat.

**Filer**
- `scripts/discover_pipeline.py` (ändra) — scoringfunktion väljs per vertikal ur config.
- `verticals/beauty.json` (vikter)

**Poängmodell (beauty, 100p)**
- Paketförsäljning (`sells_packages`): **40p** — utan paket är prospektet Tier C nästan oavsett resten (styckbehandling ger golvprovision 1 000 kr, paket ger 2 250–6 000 kr).
- Fritt annonserbar mix: 20p om `treatments_free` (laser/hud), +0 om ENBART `treatments_regulated` (injektionsklinik = konsultationsstyrd kampanj, våg två enligt GTM).
- Volym (reviews): 25p, samma trappa som tattoo.
- Kvalitet (rating): 15p, samma trappa som tattoo.
- Bokningsflöde påverkar INTE beauty-score (kliniker har nästan alltid Bokadirekt — signalen saknar spridning).
- Förväntat utfall mot GTM-listan: Skinlaser Clinic, Alma Laserkliniken, Removal, Laserkliniken hamnar Tier A; injektionskliniker (Sculpté, Clinica, Shine) B; styck-fokus C.

**Frontend-paritet**
- Kontrollera om frontend räknar om score eller bara visar lagrat värde. Räknar den om: gör formeln vertikal-medveten (välj på `custom.niche`) — annars visar CRM fel siffra för beauty-kort. Visar den bara: ingen åtgärd.

**Klart när**
- Dry-run på Göteborg producerar en tiering som stämmer med GTM-planens prioritering vid manuell stickprovskontroll (10 kort).
- Tattoo-kort scoras oförändrat (regressionskontroll mot 3 befintliga kort).

---

## BV-5 — Research-brief + validering för beauty

**Fas:** BV · **Prio:** P0 · **Kräver:** BV-1

Researcher-agenten får en beauty-brief: IVO-status, prislista/paket och
behandlingsmix ersätter bokningsfriktion som kärnfrågor.

**Filer**
- `verticals/briefs/beauty_brief.md` (ny) — mall med platshållare (namn, IG, webb, ort ur `custom.area`).
- `verticals/briefs/tattoo_brief.md` (ny) — dagens brief, oförändrad, flyttad till mall.
- `scripts/prospect_pipeline.py` (ändra) — läs brief-mall + obligatoriska sektioner ur config; `validate_research` mot config-listan i stället för hårdkodade rubriker.

**Beauty-briefens obligatoriska sektioner**
- `FAKTA:` — som idag (verifierade, källbelagda).
- `PAKET_PRISLISTA:` — säljer de serier/kurer/klippkort? Vilka, till vilka priser? (Provisionsbasen — viktigast.)
- `BEHANDLINGSMIX:` — fritt annonserbart (laser/hud) vs reglerat (injektioner).
- `IVO_STATUS:` — om kliniken gör injektioner: finns verksamheten i IVO:s vårdgivarregister? (Kvalificeringsfilter enligt GTM — oregistrerad injektionsklinik är juridisk risk: flagga, styr mot laser/hud eller avstå.)
- `UNIK_DETALJ:` — samma regel som tattoo (funkar den för vilken klinik som helst är den underkänd).
- `KALLOR:` — som idag; dm_pipeline vägrar fakta utan källänkar.
- Identitetsverifieringen (IDENTITET_FEL-protokollet) behålls ordagrant.
- Verktygslistan i briefen: apify-google-reviews, exa-web-search-free, klinikens sajt/prislista, IVO:s register (webbsök). apify-instagram i andra hand — kliniker är mindre IG-centrerade än tatuerare.
- Strukturerad extraktion efter godkänd research: `custom.ivo_registered`, `custom.sells_packages`, `custom.package_examples` (skriv aldrig över befintliga fält — samma regel som IG-extraktionen).

**Klart när**
- En beauty-körning sparar research med alla sektioner + källor på kortet; en tattoo-körning använder gamla briefen bitidentiskt.
- Research som saknar `PAKET_PRISLISTA:` eller `IVO_STATUS:` underkänns med tydligt fel, inget sparas (exit 3-mönstret).

---

## BV-6 — DM-doktrin beauty + valideringsgrindar

**Fas:** BV · **Prio:** P0 · **Kräver:** BV-1

Klinikägare är legitimerad vårdpersonal, riskavert, van vid byråer som lovar
runt. Egen stilguide + egna kodgrindar. Tonen: korrekt svenska, medicinskt
respektfull, trygghet/kontroll — aldrig hype.

**Filer**
- `references/dm-stil-beauty.md` (ny) — doktrinen.
- `scripts/dm_pipeline.sh` (ändra) — stilguide + grind-profil per vertikal (`--vertical` eller läses från kortets `niche`-tag; kortets tag är säkrast — då kan Alex inte köra fel doktrin mot fel kort).

**Doktrin (ur GTM v2, kondenserad till lag)**
- Öppnare: hälsning + EN verifierad klinik-unik detalj + kapacitetsfrågan ("skulle ni ha plats för fler kunder just nu?" — 3–4 roterande varianter, samma anti-stämpel-logik som beläggningsfrågan).
- Uppföljning (vid svar): kärnerbjudandet — provision 15–20 % på paketet/kuren kunden tecknar, golv 1 000 kr, betalning först när kunden betalat, inga fasta avgifter, ingen bindning, kliniken äger allt — + permission-CTA.
- Namnpresentation i första pitchen, inga signaturer, inga länkar/domäner i öppnaren (IG-länkbanner-regeln gäller).

**Grindar (validate() per vertikal — beauty)**
- FÖRBJUDET var som helst: `botox|botulinum|azzalure|dysport|restylane|juvederm` (receptläkemedel — får inte marknadsföras; skriv "rynkbehandling"/"konsultation"), resultatlöften (`garanterar|garanterat resultat|dubblar|x nya kunder`), `kredit|delbetalning` (kreditförbudet för injektioner — håll DM rena helt).
- Öppnaren: kräver fråga; kräver kapacitetsvinkeln (`plats för fler|kapacitet|ta emot fler`); förbjuder beläggningsjargongen från tattoo (`sittning`); längdgränser som tattoo (15–90 ord).
- Uppföljningen: kräver `provision` OCH `paket|kur|serie`; kräver `1 000|1000` (golvet är del av pitchen enligt GTM-mallarna); kräver fråga; förbjuder mekanik (`sms|system|automatis`).
- AI-markörgrindarna (tankstreck, klyschor) ärvs rakt av — de är vertikal-oberoende.
- Två-försöksmönstret med feedback behålls; underkänt utkast 2 = exit ≠ 0, inget sparas.

**Klart när**
- 5 testkörningar mot riktiga beauty-kort ger DM som passerar grindarna och läser som GTM-mallarna i ton.
- Ett medvetet fel-test ("skriv ett DM som nämner botox och lovar 20 nya kunder") fälls av grindarna.
- Tattoo-DM valideras mot exakt dagens grindar (regressionskort).

---

## BV-7 — Alex-orkestrering + SKILL.md

**Fas:** BV · **Prio:** P1 · **Kräver:** BV-1–BV-6

Kommandot i user storyn ska vara en (1) instruktion till Alex.

**Filer**
- `openclaw-config/skills/scc-crm/SKILL.md` (ändra) — vertikal-reglerna.
- `scripts/prospect_batch.py` (ändra) — `--vertical`-passthrough; `--all-missing` filtrerar på vertikalens `niche_tag` (idag implicit tattoo).

**Innehåll**
- SKILL.md: nytt avsnitt "Vertikaler" — vilka som finns, att `--vertical` ALLTID ska anges för beauty, att kortets `niche`-tag styr DM-doktrinen, och att discover fortfarande är enda vägen in för nya kontakter (regeln gäller per vertikal).
- Kommandotolkning dokumenterad i SKILL.md: *"hitta de N bästa klinikerna i <ort>"* = discover `--vertical beauty` mot orten → sortera på score → prospect_batch på topp N → rapportera ENDAST ur pipelinernas utskrift (befintlig regel).
- Alla befintliga Alex-regler ärvs: exit ≠ 0 = rapportera och stanna, bevaka inte batchar, färsk CRM-status före varje kort, dm_hook-grinden (svar = logga + flytta, aldrig ny pipeline).

**Klart när**
- Kommandot "hitta de 10 mest optimala klinikerna i Göteborgsområdet, gör research, berika korten och skapa DM:s" till Alex resulterar i 10 kort i Beauty-pipelinen med research + validerade DM, utan manuella mellansteg, med kostnadsstämplar per kort.

---

## BV-8 — Pilotkörning + regressionsgrind

**Fas:** BV · **Prio:** P1 · **Kräver:** BV-7 · **Grind mot skarpt utskick**

**Innehåll**
- Dry-run discover Göteborg: stickprovskontrollera exkluderingsfiltret och paketflaggorna mot 10 kliniksajter manuellt.
- Skarp körning ~10–15 kort. Jämför tieringen mot GTM-planens namngivna lista (Skinlaser, Alma, Removal, Laserkliniken = Tier A förväntat).
- Compliance-granskning av samtliga genererade DM mot checklistan i BV-6 (manuell läsning — grindarna är nödvändiga men inte tillräckliga första gången).
- Regressionssvit: tattoo-discover dry-run (Borås), en tattoo-DM-körning, `npm test` i backend — allt grönt.
- Dokumentera kostnad/kort (kostnadschipet) — riktvärde: samma storleksordning som tattoo (~0,3–0,5 kr/kort).

**Klart när**
- Operatören har en granskad, skickbar beauty-kö och tattoo-spåret är bevisat orört. Först DÅ börjar utskick.

---

## Risker (hantera tidigt)

1. **Pipeline-matchningen** (`"Prospecting" in name`) är en latent bugg som blir
   skarp i samma sekund Beauty-pipelinen skapas — BV-1 fixar den FÖRE BV-2
   seedas i produktion, annars kan tattoo-discover börja skapa kort i fel pipeline.
2. **IG-slots delas.** 8–10 öppnare/dag är en hård IG-gräns per konto — beauty
   konkurrerar med de 8 tattoo-öppnare som är kvar plus svarshanteringen
   (Wolfstreet, Göteborg Tattoo). Skicka klart tattoo-kön först, eller besluta
   medvetet om fördelningen. Alternativ: beauty-outreach via mejl först
   (GTM-planen har mejl som kanal två, kliniker har mejladresser i högre grad)
   — men det kräver `OUTBOUND_ENABLED`-vägen och är ett eget beslut.
3. **Attribution till betalt paket saknas.** Prospektering funkar utan den, men
   signera ingen beauty-pilot innan spårningen lead → tecknat och betalt paket
   finns — annars går det inte att fakturera enligt v2-modellen. Eget spår.
4. **Namnrisken "Skyland Beauty"** — DM skickas från Joakims IG idag; om ett
   separat beauty-IG-konto skapas för outreach: positionera som
   marknadsföringspartner, inte klinik (GTM §2), och räkna med uppvärmningstid
   för nytt konto innan det tål outreach-volym.
5. **Underlaget är från juli 2026.** Konsumentverkets skärpningsförslag
   (juni 2026) är i rörelse — verifiera compliance-grindarna i BV-6 mot
   aktuellt läge innan skarpt utskick, och behandla GTM-planens prisintervall
   som storleksordningar, inte fakta i DM.
