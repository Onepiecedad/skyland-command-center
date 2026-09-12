# Studio Fastighetsmäkleri — möte med Beata

## Kör i den här ordningen

**1. Ladda objekten** (åtta batchar, ett par minuter)

```
cd ~/skyland-command-center/maklare
MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-studio.py
```

Läs SUMMA-raden. Räkna med runt 89 skrivna och noll misslyckade.
Vill du bara ha de säljbara: lägg till `salj` sist.

**2. Skapa agenten**

Skriv de här två för hand — kopierar du dem från chatten ligger kommandot kvar i
urklipp när skriptet ber om nyckeln, och då sparas kommandot i stället.

```
bash spara-nyckel.sh
bash satt-upp-studio.sh
```

Första gången: kopiera nyckeln från elevenlabs.io/app/settings/api-keys FÖRST,
kör sedan spara-nyckel.sh och klistra in när den frågar. Den kollar att det
börjar med sk_ och vägrar spara skräp.

Öppna länken skriptet skriver ut, tryck Publish, testa i widgeten.

**3. Leadvyn** har fått Studio i rullgardinen. Öppna `leadvy.html`, välj Studio,
klistra in nyckeln.

---

## Vad de har — laddat och verifierat

89 objekt inne, noll misslyckade: 6 till salu, 11 kommande, 72 sålda.
Kontor på Götaforsliden 6.

De är inte bara Mölndal. Mölndal 66 objekt, Göteborg 13, Kungsbacka 7,
Partille 3. Bra att veta om Beata frågar om agenten klarar deras
Göteborgsobjekt — den gör det.

**Beata:** 43 sålda, 5 aktuella. Snitt 5,0 miljoner, högsta 8,75.
**Hanna:** 29 sålda, 12 aktuella. Snitt 3,3 miljoner, högsta 11,4.

Fem av de sex dyraste försäljningarna ligger i Eklanda, alla Beatas. Det är
deras starkaste område och en bra sak att låta agenten visa upp.

Datatäckning på de säljbara: avgift, driftkostnad, energiklass och förening på
15 av 17 (de två som saknar är villor utan förening). Byggår på 14, ansvarig
mäklare och område på alla 17.

På de sålda finns slutpris på 70 av 72, byggår och mäklare på alla. Avgift och
energiklass försvinner ur Mspecs när affären är klar — det är deras system som
plockar bort det, inte vår hämtning.

Stickprov mot sajten: Åby allé 5 avgift 3 083 kr, Vänortsgatan 12A 4 187 kr och
565 kr/mån driftkostnad. Stämmer på kronan.

Sajten är WordPress med Mspecs-pluginet. Datan bakom är ovanligt komplett —
månadsavgift, driftkostnad, byggår, våning, hiss, energiklass, föreningens namn
och org.nr, utförda och kommande renoveringar i föreningen, vad som ingår i
avgiften, överlåtelseavgift, tillträde och en områdesbeskrivning. Sextio till
sjuttiofem fält per objekt. Agenten kan svara på i stort sett vad som helst en
spekulant frågar om.

## Demo — fem frågor i den här ordningen

**1. "Vad har ni till salu i Eklanda?"**
Visar att den kan beståndet. Två radhus, båda med visning 6 september.

**2. "När är visningen på Eklanda Gärde?"**
Söndag 6 september klockan 13. Bokad visning, tider i kvartar.
Poängen: den vet det utan att någon matat in något.

**3. "Vad är avgiften på Vänortsgatan?"**
4 187 kronor, driftkostnad 565 i månaden. På er sajt ligger det under
Kostnader-fliken som man måste fälla ut. Agenten svarar direkt.

**4. "Jag funderar på att sälja min tvåa i Bosgården. Vad har ni sålt där?"**
Här kommer försäljningshistoriken med slutpriser. Det här är säljpitchen —
agenten fungerar lika bra mot någon som vill sälja som mot en spekulant.

**5. "Vad är min lägenhet värd då?"**
Den vägrar. Läser upp vad ni sålt men kopplar det aldrig till hennes bostad,
och bokar en riktig värdering i stället. Fråga Beata om det är rätt gräns —
det är hennes yrkesansvar, inte mitt, och gränsen är en rad i prompten.

Avsluta med att lämna namn och nummer i samtalet och visa leadet dyka upp i
leadvyn medan hon tittar på.

## Vinkeln för just dem

Beata och Hanna är två personer. När båda står på visning finns det ingen som
svarar. Det är inte "ni missar några samtal ibland" som för de stora kontoren —
det är strukturellt, varje helg, och det är då spekulanter ringer.

En spekulant som inte får svar ringer nästa mäklare. För en byrå med sex objekt
till salu är varje tappat samtal en märkbar andel av rörelsen.

## Två saker om deras sajt

Månadsavgiften ligger bakom en utfällbar flik. Det är den näst vanligaste frågan
efter priset, och den kräver två klick.

Deras objektsidor läcker en PHP-debugdump rakt i html-koden — visningsdata,
inget känsligt, men den ligger i produktion. Lämnad av deras webbleverantör.
Nämn det bara om samtalet ändå handlar om sajten. Det är inte din poäng, och det
riskerar att låta som att du sågar någon annans arbete.

## Innan du bokar

Beata konkurrerar med både HusmanHagberg och Bjurfors i Mölndal. Nämn ingen av
dem, och kolla vilken byrå som står i leadvyns rullgardin innan du delar skärm.
