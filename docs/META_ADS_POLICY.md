# Metas annonsregler för tattoo + beauty — kollat 2026-07-27

**Varför:** öppen fråga sedan HANDOVER_2026-07-27 ("Meta-policy för tattoo/
kroppsmodifiering — ej kollad, ska göras innan första kampanjen går live").
Detta stänger den frågan.

**Källäge, läs detta först.** Metas egna policysidor
(`transparency.meta.com`) renderas i webbläsaren och gick inte att läsa
maskinellt; `facebook.com/policies` blockerar hämtning. Underlaget nedan är
därför byggt på flera oberoende andrahandskällor från 2026 som citerar
regeltexten, plus dokumenterade praktikfall. Det räcker för att fatta beslut,
men **ta en egen titt i Ads Manager innan första skarpa uppladdningen** — och
räkna med att den automatiska granskningen är hårdare än regeltexten.

---

## Kortsvaret

**Tatuering är inte en förbjuden eller särskilt reglerad kategori hos Meta.**
Det finns ingen "body modification"-kategori som stoppar oss. Studios får
annonsera, och vi har bevis i egen data: Gothenburg Tattoo har kört samma
annons i 229 dagar utan att den stoppats.

Risken ligger inte i branschen utan i tre regler som lokala annonser ramlar på
av misstag. Två av dem är nu kodgrindade i `ad-factory`, den tredje kan bara
operatören sköta vid uppladdning.

---

## Risk 1 — "du + ditt tillstånd" (personliga egenskaper). KODGRINDAD.

Meta underkänner annonser som pekar ut läsarens egna förhållanden. Klassiska
fällningar är "Are you overweight?", "Struggling with debt?" — mönstret är
andra person plus ett tillstånd hos mottagaren. Att formulera det som en fråga
hjälper inte, det är just frågeformen som triggar.

**Det här är den regel vi faktiskt bröt mot.** Pistolero-paketets fjärde
annons (cover-up-vinkeln) skrev "Ångrar du din gamla tatuering i Borås?" i
rubrik, brödtext, karusell och caption. Den hade sannolikt underkänts.

Fixen är alltid densamma: beskriv **kategorin** i stället för att peka ut
läsaren. "Cover-ups och omarbetningar av äldre tatueringar, så går det till."
Samma vinkel, samma målgrupp, ingen policyrisk.

Grinden fäller nu: `lider du`, `plågas du`, `besväras du`, `skäms du`,
`ångrar du`, `är du överviktig/missnöjd/osäker`, `har du problem med`,
`trött på din/ditt/dina`. Den fäller INTE aktivitetsfrågor som "Trött på
rakning och vaxning?" — det handlar om ett moment, inte om personen.

## Risk 2 — före/efter-format. KODGRINDAD.

Regeltexten träffar bilder som visar "unexpected or unlikely results", alltså
orimliga resultat snarare än formatet i sig. Men den automatiska granskningen
slår på själva formatet, och enligt 2026-källor har den utvidgats till
"implied transformations" — en sekvens som *antyder* förvandling räknas.

Källorna är inte eniga om nuläget: majoriteten (uppdaterade maj–juni 2026)
säger att före/efter fortsatt fälls, medan en källa daterad juli 2026 hävdar
att Meta gått över till bedömning av påståenden och numera tillåter det ihop
med rimliga claims. **Vi kör på den försiktiga tolkningen**, av två skäl: vi
behöver aldrig formatet, och en fällning kostar mer än den vinner.

Detta är särskilt relevant för cover-up-vinkeln, som dras mot före/efter helt
av sig själv. Kompatibla alternativ: färdigt verk med berättande text,
process i ordning (skiss → stencil → färdigt), eller kundcitat mot färdigt verk.

Grinden fäller: `före och efter`, `innan och efter`, `before/after`,
`sida vid sida`, `delad bild`, `split screen`.

## Risk 3 — hud och tatueringsmotiv i bild. INTE KODGRINDAD, bevakas.

Det finns dokumenterade fall där annonser med synliga tatueringar fällts för
"too much skin" eller "too suggestive", och där samma bild godkänts efter att
tatueringarna retuscherats bort. Det är inte en skriven regel utan en effekt
av bildklassificeringen.

Praktisk konsekvens för fotobriefen: håll motiven på arm, underarm, hand och
rygg i vanliga kläder. Undvik bilder där stora hudytor syns för att motivet
ska få plats. Det ligger redan i linje med kursens bildregler (råa, personliga
foton från verksamheten), så det kostar oss inget.

---

## Vad bara operatören kan göra (följer med i varje paket)

Koden kan validera texten men inte hur kampanjen ställs in. `ad-factory`
skriver därför ut denna checklista i varje annonspaket:

- **Åldersgräns 18+.** Sätt den även när annonsen inte nämner något medicinskt.
  Hälso-, kropps- och skönhetsannonser får inte riktas mot minderåriga, och
  begränsningen gäller även lookalike-målgrupper byggda på källor som
  innehåller minderåriga.
- **Inga resultatgarantier** i bild, text eller på landningssidan.
- **Leadformuläret får inte fråga om hälsotillstånd.** Namn, telefon, mejl och
  vilken behandling personen är intresserad av räcker. Restriktionerna på
  känsliga fält i instant forms har breddats under 2026 och gäller inte bara
  vården.
- **Annonsen ligger i studions eget konto.** Vi har aldrig skrivåtkomst — det
  är en röd linje i annonssystemet och samtidigt det som gör att en eventuell
  fällning drabbar en kampanj, inte hela vår verksamhet.

## Beauty-vertikalen: samma regler, hårdare tillämpning

Estetikkliniker ligger i Metas hälso- och wellnesskategori, där granskningen
är strängare och kroppsbildsreglerna gäller fullt ut: inget som "implies or
attempts to generate negative self-perception", inga kroppsdelsnärbilder som
antyder skam, inget stigmatiserande språk om vikt eller kropp.

Notera spänningen mot vår egen data: långkörarna i `ad_library` använder just
tillståndsfrågor ("Lider du av röda prickar, irritation och inåtväxande
hårstrån?" — Comforth Scandinavia). De har uppenbarligen passerat granskningen
och rullat länge. Att någon annans annons klarat sig är dock inte ett löfte om
att vår gör det, och det är kundens konto som står på spel. Vi kör
kategoriformuleringen.

De juridiska grindarna i beauty-DM-doktrinen (inga läkemedelsnamn, inga
resultatgarantier, ingen kredit/delbetalning) gäller oförändrat i annonser och
ligger redan i `dm_pipeline`. De skyddar mot svensk lag, inte mot Meta —
båda måste hållas.

## Vad som ändrades i systemet av den här kollen

- `ad-factory`: två nya kodgrindar (personliga egenskaper, före/efter) som
  körs både på konceptnivå och på färdig copy. Testade mot det redan
  producerade Pistolero-paketet: fäller annons 4, lämnar 1–3 orörda, och ger
  inga falska utslag på godkända formuleringar.
- `ad-factory`: varning när copyn nämner laser, behandling, klinik, medicinsk
  eller injektion — då gäller hälso-/wellnessreglerna och 18+.
- Varje annonspaket får ett avsnitt "Meta-policy" med operatörschecklistan.
- Copysteget får reglerna i prompten i förväg, så modellen slipper lära sig
  dem genom att bli underkänd.

## Att göra om

Meta ändrar de här reglerna ofta — bara under 2026 finns dokumenterade
ändringar i mars, april, maj och (omtvistat) juli. Läs om dokumentet vid
tecken på ökade fällningar, och senast var sjätte månad.

## Källor

- [Health and Wellness — Meta Transparency Center](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/) (primär, kunde ej läsas maskinellt)
- [Privacy Violations and Personal Attributes — Meta Transparency Center](https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/) (primär, kunde ej läsas maskinellt)
- [Personal Attributes — Ad Rejection Guide](https://www.auditsocials.com/knowledge/rejections/personal-attributes)
- [Meta Weight Loss & Supplement Ads 2026: Banned Claims](https://www.auditsocials.com/blog/meta-health-wellness-restricted-ads-2026-supplements-body-image-medical-claim-rules)
- [Meta Beauty Ads 2026: Before/After & Body Image Rules](https://www.auditsocials.com/blog/meta-beauty-cosmetic-ads-before-after-photos-body-image-policy-2026)
- [Meta Ad Policy Updates 2026](https://www.auditsocials.com/blog/meta-ad-policy-updates-2026-guide)
- [Meta Health and Wellness Restrictions in 2026 — Aixel](https://aixel.io/blog/meta-health-wellness-ad-restrictions-2026)
- [Meta Health & Wellness Ad Policy Update (July 2026) — Clikim](https://clikim.com/meta-health-wellness-policy-update/) (avvikande uppgift om före/efter)
- [Before/After Skincare Ads on Meta and TikTok 2026 — InnoBotZ](https://innobotz.com/blog/articles/skincare-before-after-ad-compliance-meta-tiktok-2026.html)
- [Before-and-After Tattoo Ads on Meta — Stackmatix](https://www.stackmatix.com/blog/tattoo-shop-before-after-ads-meta-policy)
- [Is Facebook Blocking Ads with Tattoos? — Allebach Photography](https://allebachphotography.com/blog/is-facebook-blocking-ads-with-tattoos/)
