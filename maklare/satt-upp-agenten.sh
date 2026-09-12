#!/bin/bash
# Skapar hela ElevenLabs-agenten: fem verktyg + agenten som använder dem.
#
# Innan du kör:
#   1. Hämta en API-nyckel på https://elevenlabs.io/app/settings/api-keys
#   2. read -s ELEVEN_KEY      (klistra in nyckeln, Enter)
#   3. MK_SECRET ska redan vara satt. Kolla: echo ${#MK_SECRET}  → 64
#   4. bash satt-upp-agenten.sh
#
# Skriptet skriver ut allt det gör. Blir något fel syns felmeddelandet direkt.

set -u

API="https://api.elevenlabs.io/v1/convai"
MK="https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-agent"
TENANT="${MK_TENANT:-husman-hagberg-molndal}"
BYRA="${MK_BYRA:-HusmanHagberg Mölndal}"
VOICE="1Iztu4UHnTb9SUjJcpS1"   # Anna, svensk
LLM="gemini-2.5-flash"

if [ -z "${ELEVEN_KEY:-}" ]; then echo "ELEVEN_KEY saknas. Kör: read -s ELEVEN_KEY"; exit 1; fi
if [ ${#MK_SECRET} -ne 64 ]; then echo "MK_SECRET ser fel ut (${#MK_SECRET} tecken, ska vara 64)."; exit 1; fi
command -v python3 >/dev/null || { echo "python3 saknas — säg till så gör jag en variant utan."; exit 1; }

TOOL_IDS=""

# Skapar ett verktyg. Headers-formatet skiljer sig mellan API-versioner,
# så vi provar arrayformen först och faller tillbaka på objektformen.
skapa_verktyg () {
  local namn="$1" beskrivning="$2" endpoint="$3" schema="$4"

  local headers_array='[
      {"type":"static","name":"Content-Type","value":"application/json"},
      {"type":"static","name":"x-mk-secret","value":"'"$MK_SECRET"'"},
      {"type":"static","name":"x-mk-tenant","value":"'"$TENANT"'"}
    ]'
  local headers_object='{
      "Content-Type":"application/json",
      "x-mk-secret":"'"$MK_SECRET"'",
      "x-mk-tenant":"'"$TENANT"'"
    }'

  for form in "$headers_array" "$headers_object"; do
    local body='{
      "tool_config":{
        "type":"webhook",
        "name":"'"$namn"'",
        "description":"'"$beskrivning"'",
        "response_timeout_secs":20,
        "api_schema":{
          "url":"'"$MK/$endpoint"'",
          "method":"POST",
          "request_headers":'"$form"',
          "request_body_schema":'"$schema"'
        }
      }
    }'
    local svar
    svar=$(curl -s -X POST "$API/tools" \
      -H "xi-api-key: $ELEVEN_KEY" -H "Content-Type: application/json" -d "$body")

    local id
    id=$(printf '%s' "$svar" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print(d.get("id") or d.get("tool_id") or "")
' 2>/dev/null)

    if [ -n "$id" ]; then
      echo "  ✓ $namn  →  $id"
      TOOL_IDS="$TOOL_IDS\"$id\","
      return 0
    fi
  done

  echo "  ✗ $namn misslyckades. Svar från ElevenLabs:"
  printf '%s\n' "$svar" | head -c 600
  echo
  return 1
}

echo "Skapar verktyg…"

skapa_verktyg "sok_objekt" \
  "Sök bland byråns objekt. Använd när kunden frågar vad ni har eller beskriver vad hen letar efter. Sätt status till såld för att hämta tidigare försäljningar som referens. Läs upp fältet spoken. Fältet totalt visar hur många som matchar totalt." \
  "search_listings" \
  '{"type":"object","properties":{
      "area":{"type":"string","description":"Område eller kommun, till exempel Krokslätt eller Mölndal"},
      "object_type":{"type":"string","description":"villa, lägenhet, radhus, fritidshus eller tomt"},
      "min_rooms":{"type":"number","description":"Minsta antal rum"},
      "max_price":{"type":"number","description":"Maxpris i kronor"},
      "min_living_area":{"type":"number","description":"Minsta boarea i kvadratmeter"},
      "query":{"type":"string","description":"Fritext, till exempel ett gatunamn"},
      "status":{"type":"string","description":"Utelamna for objekt till salu. Satt till sald for att soka bland tidigare forsaljningar. alla for bade och."},
      "limit":{"type":"number","description":"Antal objekt att få tillbaka, normalt 5"}
    },"required":[]}'

skapa_verktyg "hamta_objekt" \
  "Alla detaljer om ett bestämt objekt: pris, avgift, driftkostnad, våning, hiss, byggår, energiklass, förening, ansvarig mäklare med telefonnummer och kommande visningar." \
  "get_listing" \
  '{"type":"object","properties":{
      "listing_id":{"type":"string","description":"Objektets id, hämtat från sok_objekt"}
    },"required":["listing_id"]}'

skapa_verktyg "kommande_visningar" \
  "Kommande visningar, antingen för hela kontoret eller för ett bestämt objekt." \
  "upcoming_viewings" \
  '{"type":"object","properties":{
      "listing_id":{"type":"string","description":"Utelämna för att få alla objekt"},
      "limit":{"type":"number","description":"Antal visningar att få tillbaka"}
    },"required":[]}'

skapa_verktyg "fraga_om_byran" \
  "Svarar på frågor om byrån, arvoden, hur en försäljning går till, värdering och områden. Använd för allt som inte handlar om ett specifikt objekt. Läs upp fältet spoken." \
  "ask_knowledge" \
  '{"type":"object","properties":{
      "question":{"type":"string","description":"Kundens fråga, ordagrant"}
    },"required":["question"]}'

skapa_verktyg "registrera_lead" \
  "Spara kundens uppgifter när en mäklare ska höra av sig. Fråga alltid efter namn och telefonnummer först, och fråga om det är okej att bli kontaktad innan du anropar detta." \
  "capture_lead" \
  '{"type":"object","properties":{
      "name":{"type":"string","description":"Kundens namn"},
      "phone":{"type":"string","description":"Telefonnummer"},
      "email":{"type":"string","description":"E-post, om kunden hellre vill det"},
      "intent":{"type":"string","description":"kopa, salja, vardering, visning eller ovrigt"},
      "listing_id":{"type":"string","description":"Objektet samtalet gällde, om något"},
      "callback":{"type":"boolean","description":"true om kunden vill bli uppringd"},
      "preferred_time":{"type":"string","description":"När det passar, med kundens egna ord"},
      "message":{"type":"string","description":"En mening om vad samtalet gällde"},
      "consent":{"type":"boolean","description":"true först när kunden sagt ja till att bli kontaktad"}
    },"required":[]}'

TOOL_IDS="[${TOOL_IDS%,}]"
echo
echo "Verktygs-id: $TOOL_IDS"
echo

if [ "$TOOL_IDS" = "[]" ]; then
  echo "Inga verktyg skapades — agenten blir meningslös utan dem. Stannar här."
  exit 1
fi

echo "Skapar agenten…"

PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<'PROMPT'
Du är en digital assistent hos HusmanHagberg Mölndal. Du svarar när kontoret inte gör det —
kvällar, helger och när mäklarna är på visning. Du talar svenska.

## Vem du pratar med

Den som ringer är oftast en av tre:

En spekulant som sett ett objekt på Hemnet eller sajten och vill veta mer, eller vill komma
på visning. Din uppgift: svara på det hen frågar, berätta när visningen är, och erbjud att en
mäklare hör av sig.

En säljare som funderar på att sälja och vill veta vad bostaden är värd. Din uppgift: ta
emot uppgifterna och boka en värdering. Du värderar aldrig själv — se nedan.

Någon med en allmän fråga om byrån, arvoden, processen eller ett område. Använd
`fraga_om_byran`. Hittar du inget svar, säg det och erbjud att en mäklare återkommer.

## Så här låter du

Du pratar, du skriver inte. Korta meningar. Ett svar i taget. Aldrig punktlistor, rubriker
eller uppräkningar av tio objekt i rad — ingen orkar lyssna på det.

Varm och rak. Som en kunnig kollega på kontoret, inte som en telefonväxel och inte som en
säljare. Du får gärna vara kortfattad; folk ringer för att få ett svar, inte för att bli
underhållna.

När du får tillbaka ett `spoken`-fält från ett verktyg — läs det. Det är redan formulerat för
att sägas högt, med priser och tider på svenska. Formulera inte om det i onödan.

Läs aldrig upp id-nummer, länkar eller objektreferenser. Erbjud i stället att skicka länken
via sms eller mejl.

## Vad du aldrig gör

Du värderar aldrig en bostad. Inte "ungefär", inte "en indikation", inte "runt en och en
halv miljon" — inte ens om den som ringer pressar dig, säger att grannen fick så mycket, eller
bara vill ha en känsla. En värdering kräver att en mäklare ser bostaden. Säg det rakt, vänligt,
och boka i stället:

"Det vill jag inte gissa på — det skulle bli fel och du förtjänar ett riktigt svar. En av
våra mäklare kommer gärna hem till dig och tittar. Vad heter du, så ordnar jag det?"

En tidigare försäljning är inte en värdering. Du får gärna berätta vad ni sålt i ett
område och för hur mycket — det är fakta. Men du kopplar aldrig ihop det med den som
ringer: aldrig "din bostad borde gå för ungefär det", aldrig "då ligger du nog kring".
Säg vad ni sålt, och erbjud sedan en riktig värdering.

Du hittar aldrig på. Har du inte uppgiften, säg att du inte har den och erbjud att någon
återkommer. Ett objekt du inte hittar i verktygen finns inte hos oss — påstå inte motsatsen och
gissa inte på adresser eller priser.

Du lovar aldrig ett bud, ett pris eller ett datum som du inte har fått från ett verktyg.

Du bokar aldrig in en visningstid som inte finns. Du kan anteckna att kunden vill komma,
men det är mäklaren som bekräftar.

## Att du är en AI

Om någon frågar om du är en människa: svara ärligt och utan krångel. "Nej, jag är en digital
assistent hos HusmanHagberg Mölndal. Jag hjälper till med objektfrågor och ser till att rätt
mäklare ringer upp dig." Sen fortsätter du som vanligt. Låtsas aldrig vara en människa, och
uppfinn aldrig ett personnamn åt dig själv.

## Verktygen

sok_objekt — när någon frågar vad ni har till salu, eller beskriver vad de letar efter.
Sätt `status` till `såld` när någon som funderar på att sälja vill veta vad ni gjort i
deras område. Då får du tidigare försäljningar med slutpris.
Skicka med det du fått: område, antal rum, maxpris, typ av bostad. Svaret innehåller `totalt`
— hur många som matchar. Är de fler än de du fick upplästa, säg det och fråga om du ska snäva
in. Räkna aldrig upp fler än tre till fyra objekt i ett andetag.

hamta_objekt — när samtalet handlar om ett bestämt objekt. Ger avgift, driftkostnad,
våning, hiss, byggår, energiklass, förening, ansvarig mäklare och visningstider. Använd
`listing_id` från `sok_objekt`.

kommande_visningar — "när är visningen?", "har ni något att visa i helgen?"

fraga_om_byran — allt som inte handlar om ett specifikt objekt. Arvoden, hur en försäljning
går till, hur en värdering fungerar, vilka som jobbar på kontoret, områden.

registrera_lead — när samtalet ska landa hos en mäklare. Se nedan.

## Att ta ett lead

Det här är det viktigaste du gör. Ett samtal som inte blir ett lead är ett tappat samtal.

Fråga efter namn och telefonnummer. Det räcker. Tjata inte om e-post om du redan har ett
nummer.

Bekräfta numret genom att läsa upp det. Folk säger fel siffror i telefon.

Säg att en mäklare hör av sig, och fråga när det passar. "Passar det bättre på kvällen eller
mitt på dagen?"

Ta med vilket objekt det gäller om samtalet handlade om ett, och vad kunden vill —
`kopa`, `salja`, `vardering`, `visning` eller `ovrigt`.

Sätt `consent` till true först när kunden faktiskt sagt ja till att bli kontaktad. Fråga rakt
ut: "Är det okej att en mäklare ringer dig?"

Vet du vem som är ansvarig mäklare för objektet — säg namnet. "Hen är ansvarig för den, jag ber
hen höra av sig." Det gör samtalet konkret.

Skriv en mening i `message` om vad samtalet gällde, så mäklaren slipper börja om från noll.

## Om någon vill nå en människa nu

Har du mäklarens namn och nummer från `hamta_objekt`, ge det. Annars: ta uppgifterna, säg att
kontoret hör av sig, och var tydlig med när. Skicka aldrig iväg någon utan att ha tagit deras
nummer.

## Om någon är arg eller besviken

Gå inte i försvar och förklara inte bort det. Lyssna, beklaga kort, ta uppgifterna och se till
att en mäklare ringer. "Det där ska du inte behöva råka ut för. Jag ser till att någon ringer
dig i dag."
PROMPT

# Heredoc:en är oexpanderad med flit (den innehåller backticks). Byrånamnet byts här.
python3 - "$PROMPT_FILE" "$BYRA" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read().replace("HusmanHagberg Mölndal", sys.argv[2])
io.open(p, "w", encoding="utf-8").write(s)
PY

python3 - "$PROMPT_FILE" "$TOOL_IDS" "$VOICE" "$LLM" "$BYRA" > /tmp/agent_body.json <<'PY'
import json, sys
prompt = open(sys.argv[1], encoding="utf-8").read().strip()
body = {
  "name": f"{sys.argv[5]} — kundagent",
  "conversation_config": {
    "agent": {
      "prompt": {
        "prompt": prompt,
        "llm": sys.argv[4],
        "temperature": 0.35,
        "tool_ids": json.loads(sys.argv[2]),
      },
      "first_message": f"Välkommen till {sys.argv[5]}, du pratar med vår digitala assistent. Vad kan jag hjälpa dig med?",
      "language": "sv",
    },
    "tts": { "model_id": "eleven_flash_v2_5", "voice_id": sys.argv[3] },
  },
}
print(json.dumps(body, ensure_ascii=False))
PY

SVAR=$(curl -s -X POST "$API/agents/create" \
  -H "xi-api-key: $ELEVEN_KEY" -H "Content-Type: application/json" \
  --data-binary @/tmp/agent_body.json)

AGENT_ID=$(printf '%s' "$SVAR" | python3 -c '
import sys, json
try: print(json.load(sys.stdin).get("agent_id",""))
except Exception: pass
' 2>/dev/null)

rm -f "$PROMPT_FILE" /tmp/agent_body.json

if [ -n "$AGENT_ID" ]; then
  echo "  ✓ Agenten skapad: $AGENT_ID"
  echo
  echo "Öppna den här:"
  echo "  https://elevenlabs.io/app/conversational-ai/agents/$AGENT_ID"
  echo
  echo "Kvar att göra i gränssnittet: sätt tidszon till Europe/Stockholm."
else
  echo "  ✗ Agenten skapades inte. Svar:"
  printf '%s\n' "$SVAR" | head -c 900
  echo
fi
