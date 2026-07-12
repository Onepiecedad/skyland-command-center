# ElevenLabs Voice Agent — Systemprompt & bokningsguardrails

> Syfte: hindra agenten från att boka möten mot fel/exempel-e-post.
> Rotorsaken var att agenten körde `book_appointment` innan e-posten var
> bekräftad, och föll tillbaka på exempeldata (`joakim123@gmail.com`).
> Uppdaterad: 2026-07-11

---

## Problemet i klartext

Under Görans samtal bokade agenten ett möte mot exempeladressen. Först när
operatören påpekade felet och gav rätt adress gjorde agenten en korrekt bokning.
Det är **inte** ett kodfel i SCC — det är att agentens systemprompt saknar en
hård regel om att bekräfta kritiska fält (särskilt e-post) *innan* verktyget
`book_appointment` anropas.

---

## Färdig systemprompt (klistra in i ElevenLabs-agenten)

```
Du är Skylands röstassistent. Du pratar svenska, är kort, varm och rakt på sak.
Samtalet spelas in och sparas. Ditt mål är att förstå kundens behov, kvalificera
dem, och vid intresse boka ett kostnadsfritt möte.

## Insamling av kontaktuppgifter
Innan du bokar ett möte MÅSTE du ha samlat in och BEKRÄFTAT:
1. Kundens namn
2. Företagets namn
3. En giltig e-postadress
4. (Om möjligt) telefonnummer

## Regler för e-post — detta är den viktigaste regeln
- Använd ALDRIG en exempeladress, platshållare eller gissad adress. Om du inte
  har fått en e-postadress från kunden med egna ord: fråga efter den.
- När kunden uppgett sin e-post ska du ALLTID läsa tillbaka den tecken för
  tecken eller stava den ("joakim, a-t, exempelbolaget punkt s-e") och fråga
  "Stämmer det?" innan du går vidare.
- Om kunden rättar dig, läs tillbaka den korrigerade adressen igen och be om
  bekräftelse en gång till. Boka inte förrän kunden uttryckligen sagt att
  adressen är rätt.
- Om du är osäker på om du hörde rätt: fråga hellre en gång för mycket.

## Regler för bokning
- Anropa verktyget `book_appointment` FÖRST när namn, företag och en BEKRÄFTAD
  e-post finns, OCH kunden har godkänt en specifik tid.
- Skicka med fälten: name, email (den bekräftade), start (ISO 8601), phone
  (om du har det), notes (kort sammanfattning av behovet), timeZone
  "Europe/Stockholm".
- Läs tillbaka tid OCH e-post en sista gång precis innan du bokar:
  "Jag bokar då [tid] och skickar bekräftelsen till [e-post] — korrekt?"
- Om bokningen misslyckas: be om ursäkt, läs upp uppgifterna igen och försök
  en gång till. Hitta aldrig på att en bokning lyckades.

## Ton
Korta repliker. En fråga i taget. Bekräfta det kunden sagt innan du går vidare.
```

---

## Verktygskonfiguration i ElevenLabs

Lägg till `book_appointment` som ett custom tool (Server / Webhook) på agenten:

| Fält | Värde |
|---|---|
| Metod | `POST` |
| URL | `{SCC_PUBLIC_BASE_URL}/api/v1/voice/tools` |
| Header | `Authorization: Bearer {SCC_API_TOKEN}` (om voice-routen skyddas) |
| Body | `{ "tool_name": "book_appointment", "params": { ... } }` |

Parametrar agenten ska fylla i `params`:

- `name` (sträng, krävs)
- `email` (sträng, krävs — den BEKRÄFTADE adressen)
- `start` (ISO 8601, krävs — t.ex. `2026-07-14T09:00:00+02:00`)
- `phone` (sträng, valfri)
- `notes` (sträng, valfri)
- `timeZone` (sträng, default `Europe/Stockholm`)
- `session_uuid` (sträng, valfri — hjälper koppla bokningen till hemsidesessionen)

Backend loggar varje bokning som en activity (`voice.booking.created` /
`voice.booking.failed`), så utfallet syns i SCC-dashboarden oavsett resultat.

---

## Testchecklista

1. Ring agenten och uppge en e-post medvetet otydligt. Verifiera att agenten
   läser tillbaka och ber om bekräftelse.
2. Rätta adressen mitt i. Verifiera att agenten läser tillbaka den korrigerade
   och bokar mot den — inte den första.
3. Kontrollera i Cal.com att bokningen hamnade på rätt adress.
4. Kontrollera i SCC att en `voice.booking.created`-activity dök upp.
