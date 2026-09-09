# Annonsmotorn

Två halvor som förut aldrig möttes.

**`ad_library`** är konkurrenternas annonser, hämtade ur Metas Ad Library.
4 648 rader: arctic 3 480, kampsport 487, tattoo 400, beauty 281.
Fylls av `ad-intel`-skillen. Ad Library visar aldrig spend eller resultat, så
körtid är enda prestandaproxyn: *"har rullat N dagar, sannolikt lönsam"*,
aldrig *"presterar bäst"*.

**`ad_performance`** är våra egna annonser: spend, visningar, CTR, CPC, CPM,
videoräknare och resultat, en rad per annons och dag. Fylls av edge-funktionen
`ads-sync`. Det är den halvan som gör kvalitetssäkring möjlig, för kvalitet är
inte hur annonsen ser ut utan vad den kostar per resultat.

## Tabeller och vyer

| Objekt | Vad den gör |
| --- | --- |
| `ad_accounts` | Kopplar ett Meta-annonskonto till en kund i `customers`. Ett konto hör till exakt en kund. |
| `ad_performance` | En rad per annons och dag. Unik på `(platform, ad_id, date)`, så omkörning uppdaterar i stället för att dubblera. `raw` sparar Metas obearbetade svar så nya mått kan räknas fram utan ny hämtning. |
| `ad_targets` | Mål och spendgolv per kund, kampanj eller annons. Det mest specifika vinner. |
| `ad_health` | Grönt, gult, rött per annons de senaste 30 dagarna, med skäl i klartext. |
| `ad_funnel` | Annonskostnad möter CRM-utfall via `ad_id`. Kostnad per lead, per het lead, per bokning. |

### Varför grått inte är rött

`ad_health` har fyra färger, inte tre. **Grått betyder "vet inte än"**: annonsen
har inte spenderat upp till sitt `spend_floor`. Att pausa en annons som knappt
fått pengar är det vanligaste sättet att döda något som hade fungerat, och det
är därför spendgolvet är obligatoriskt och inte en detalj.

### Varför måltal är per kund

En provträning hos Göteborgs Krav Maga Klubb och en Lapplandsresa för
1 250 till 2 250 euro per vuxen kan inte dömas med samma linjal. `ad_targets`
har därför `customer_id` på varje rad, och `yellow_margin` (standard 25 procent)
avgör hur långt över målet som är gult innan det blir rött.

## Vad som saknas för att det ska köra

Två hemligheter. **Sätt dem själv i Supabase, skicka dem aldrig i chatten.**

### 1. `META_ADS_TOKEN`

En systemanvändartoken med `ads_read` på kundernas annonskonton.

- Business Settings → Users → System Users → lägg till eller välj en
- Generate New Token → välj appen → kryssa i **`ads_read`**
- Ge systemanvändaren **Partial access → View performance** på varje
  annonskonto som ska läsas (Business Settings → Accounts → Ad Accounts)
- Kopiera token till Supabase → Edge Functions → Secrets som `META_ADS_TOKEN`

Ligger kunderna i olika Business Managers behövs antingen en token per BM,
eller att Skylands BM får partneråtkomst till varje annonskonto. Det senare är
enklare att leva med.

**Vägar som INTE fungerar, testade 9 sep 2026:**

- **Windsor.ai**: noll kopplade konton, gratisplan. `get_connectors` returnerar
  tom lista. Ingen data alls går den vägen.
- **`META_PAGE_TOKEN`**: är en *sid*token. `/me` löser till sidan Cold
  Experience, så `/me/adaccounts` och `/me/businesses` svarar
  `(#100) Tried accessing nonexisting field`. Sidtoken kan aldrig läsa
  annonsstatistik, hur mycket behörighet den än har på sidan.

### 2. `ADS_SYNC_KEY`

En gissningssäker nyckel som skyddar endpointen. `openssl rand -hex 24`.
Sätts på **två** ställen:

- Supabase → Edge Functions → Secrets, som `ADS_SYNC_KEY`
- Supabase → Vault, som en secret med namnet `ADS_SYNC_KEY`

Vault-kopian är den cron läser. Utan den gör det schemalagda jobbet ingenting
och säger det i loggen, i stället för att skicka ett anrop som ändå nekas.

`ads-sync` felar stängt: saknas någon av de två hemligheterna svarar den 503
och gör ingenting. En öppen endpoint som läser annonsdata för fem kunder är
inte värd risken.

## Kom igång, i ordning

```bash
# 1. Se vilka annonskonton token faktiskt når
curl -s -H "x-ads-key: $ADS_SYNC_KEY" \
  "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/ads-sync?discover=1"
```

```sql
-- 2. Koppla varje konto till rätt kund
insert into ad_accounts (customer_id, account_id, account_name, currency)
select id, 'act_XXXXXXXXXX', 'Cold Experience', 'SEK'
from customers where slug = 'gustav';
```

```bash
# 3. Hämta historik en gång (Meta ger normalt 37 månader bakåt)
curl -s -X POST -H "x-ads-key: $ADS_SYNC_KEY" \
  "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/ads-sync?from=2026-06-01&to=2026-09-08"
```

```sql
-- 4. Sätt mål och spendgolv per kund. Siffrorna nedan är PLATSHÅLLARE,
--    de ska vara dina riktiga tal.
insert into ad_targets (customer_id, target_cost, spend_floor, currency, note)
select id, 250, 1000, 'SEK', 'kostnad per formulärslead'
from customers where slug = 'gustav';
```

```sql
-- 5. Läs av
select * from ad_health order by status, spend desc;
select * from ad_funnel order by spend desc nulls last;
```

Därefter kör cron-jobbet `ads_sync_daglig` 06:15 UTC varje dag och hämtar de
tre senaste dagarna. Fönstret är tre dagar, inte en, för Meta räknar om
resultat i efterhand när attributionsfönstret stänger.

## Läget just nu

`ad_funnel` visar redan en rad, utan att en enda siffra hämtats från Meta:

| ad_id | leads | heta | överlämnade | bokade | spend |
| --- | --- | --- | --- | --- | --- |
| 120250607553950299 | 78 | 30 | 0 | 0 | *saknas* |

**77 av 79 Cold Experience-leads kommer från en enda annons.** Trettio av dem
är heta. Noll är överlämnade eller bokade. Så fort spend finns går kostnad per
het lead att räkna, och det är den siffra som avgör om annonsen ska få mer
pengar. Att `överlämnade` och `bokade` står på noll är en signal om Gustavs
uppföljning, inte ett fel i datat.
