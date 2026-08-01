# Felsökning: varför Alex rapporterar mer än den utför

**Datum:** 1 augusti 2026
**Metod:** kodgranskning av `backend/src/services/alexBrain.ts`, `backend/src/llm/tools.ts`, `backend/src/llm/adapter.ts` och `openrouterAdapter.ts`. Ingen körning, ingen logginspektion.

**Testfallet:** instruktion med sex ändringar på kortet All Gold Tattoo. Fyra utfördes (status, contact_person, contact_notes, dm_notes). Två gjordes inte (byta namn på kortet, ersätta research_notes). Alex rapporterade samtliga sex som klara. I körningen dessförinnan utfördes noll ändringar och svaret slutade med "Jag kommer att uppdatera alla dessa ändringar i vårt CRM nu."

Det finns fyra separata orsaker. De förklarar tillsammans exakt det beteende du sett.

---

## 1. Alex kan inte byta namn på ett kort. Verktyget saknar fältet.

`tools.ts` rad 215, `update_contact`. Tillåtna parametrar är:

`contact_id, status, phone, email, website, company, add_tags, remove_tags, custom`

Det finns **inget `name`-fält**. Kortets namn går alltså inte att ändra med något verktyg Alex har. Den kunde inte utföra omdöpningen ens i teorin, men rapporterade den som gjord eftersom den låg i planen den formulerat.

`research_notes` är däremot skrivbart via `custom`. Att den ändå inte skrevs är en ren utelämning från modellen: den skickade ett `custom`-objekt med tre nycklar och hoppade över den fjärde, och rapporterade sedan alla fyra.

**Åtgärd:** lägg till `name` i schemat och i handlern. Utan det kommer varje framtida omdöpning tyst att misslyckas på samma sätt.

---

## 2. Alex text FÖRE verktygen körts kan bli det slutliga svaret

`alexBrain.ts`, sista raderna i loopen:

```js
if (llmResponse.text) {
    responseText = llmResponse.text;
}
```

Det här körs i varje runda, även rundor där modellen också returnerade verktygsanrop. Språkmodeller skriver rutinmässigt en följetext bredvid sina verktygsanrop, i stil med "Jag kommer att uppdatera det här nu". Den texten fångas här och skrivs in i `responseText`.

Om nästa runda inte producerar någon text, eller om loopen bryts, är det den **avsiktsformuleringen** användaren får som slutsvar. Det är ordagrant meddelandet du fick första gången.

Detta är den enskilt viktigaste buggen. Svaret användaren läser är inte en rapport om vad som hände, det är i värsta fall en plan skriven innan något hänt.

**Åtgärd:** sätt aldrig `responseText` i en runda som innehåller verktygsanrop. Låt bara grenen utan verktygsanrop sätta den, och kör den befintliga sammanfattningsrundan när `responseText` är tom, inte bara när `round >= MAX_TOOL_ROUNDS`.

---

## 3. Verktygsresultaten matas tillbaka som fejkad chatt, inte som verktygsprotokoll

```js
currentMessages.push({
    role: 'assistant',
    content: `Jag använder verktyg: ${namn.join(', ')}`
});
currentMessages.push({
    role: 'user',
    content: `Verktygsresultat:\n${...}`
});
```

Det riktiga protokollet används inte. `ChatMessage` i `adapter.ts` tillåter bara rollerna `user`, `assistant` och `system`, och `ToolCall` saknar helt ett `id`-fält. Anropens identiteter kastas alltså bort på typnivå.

Följden är att modellen aldrig ser någon strukturell koppling mellan "det här bad jag om" och "det här kom tillbaka". Den ser en vanlig textrad som påstår sig innehålla resultat. Den har därmed ingen tillförlitlig grund för att skilja *planerade* operationer från *utförda*, och faller tillbaka på sin egen plan när den sammanfattar. Det är precis den förväxling du ser.

Dessutom är den påhittade assistentraden "Jag använder verktyg: ..." i sig en text som säger att något gjorts, oavsett vad resultaten visar.

**Åtgärd:** lägg till `id` på `ToolCall`, tillåt rollen `tool` i `ChatMessage`, och skicka tillbaka riktiga `tool_calls` på assistentmeddelandet plus ett `role: "tool"`-meddelande per resultat med matchande `tool_call_id`. Det berör `adapter.ts`, de tre adaptrarna och `alexBrain.ts`. Detta är den strukturella fixen.

---

## 4. Instruktionen efter varje runda belönar berättelse och förbjuder bevis

Samma push, sista stycket:

> "Om du behöver använda fler verktyg, gör det. Annars sammanfatta på ENKEL SVENSKA. Förklara för en person som INTE kan programmera. Inga JSON-objekt eller teknisk kod i svaret!"

Den här texten injiceras efter varje runda och gör två saker samtidigt. Den drar mot att avsluta och sammanfatta i stället för att fortsätta arbeta, och den **förbjuder uttryckligen** att visa den tekniska detalj som skulle avslöja ett delvis resultat. Modellen optimerar alltså mot en trevlig berättelse och är instruerad att utelämna kvittona.

**Åtgärd:** byt ut mot något i stil med:

> "Rapportera exakt vad verktygsresultaten ovan visar. Påstå aldrig att något är utfört om det inte framgår av ett resultat. Om du saknar verktyg för något du ombetts göra, säg det rakt ut. Skriv begripligt, men lista varje ändring med utfall: gjord, misslyckad eller inte möjlig."

---

## Bonus: tysta fel i senare rundor

```js
} catch (llmError) {
    if (round === 1) { throw ... }
    break; // On later rounds, use whatever we have so far
}
```

Fallerar LLM-anropet i runda 2 eller senare bryts loopen tyst och den befintliga `responseText` används, som enligt punkt 2 mycket väl kan vara en avsiktsformulering. Användaren får då ett självsäkert svar om ett arbete som avbröts av ett fel.

**Åtgärd:** markera svaret som ofullständigt när loopen bryts på fel, och säg det i utdatan.

---

## Prioritering

| # | Åtgärd | Insats | Effekt |
|---|---|---|---|
| 2 | Sluta fånga text från verktygsrundor | ~15 min | Störst. Tar bort "jag kommer att..."-svaren direkt |
| 4 | Skriv om instruktionen efter varje runda | ~15 min | Stor. Tvingar fram utfall per operation |
| 1 | Lägg till `name` i `update_contact` | ~30 min | Tar bort en kategori av tysta misslyckanden |
| 3 | Riktigt verktygsprotokoll med `tool_call_id` | halvdag | Strukturell rot. Utan den kvarstår grundförväxlingen |
| 5 | Markera avbrutna loopar som ofullständiga | ~15 min | Liten men billig |

Punkt 2 och 4 tillsammans tar troligen bort merparten av symptomen på under en timme. Punkt 3 är den som gör att problemet inte kommer tillbaka i ny form.

---

## Att verifiera i loggarna

`alexBrain` loggar redan per runda:

- `LLM round N/5`
- `Round N: Processing X tool calls`
- `Executing tool: <namn>`

Sök upp de två körningarna mot All Gold-kortet. Den första bör visa noll `Executing tool`-rader trots ett självsäkert svar, den andra bör visa `update_contact` men aldrig något anrop som rör kortnamnet. Det bekräftar punkt 1 och 2 empiriskt.
