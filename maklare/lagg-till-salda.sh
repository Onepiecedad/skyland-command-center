#!/bin/bash
# Lägger till verktyget "tidigare_forsaljningar" på en befintlig agent, och
# skärper prompten så att historik inte förväxlas med värdering.
#
# Kör: bash lagg-till-salda.sh <agent_id> <tenant-slug>
# Ex:  bash lagg-till-salda.sh agent_5001m13nma9aftcavb6mwkt8stv6 studio-molndal
set -u

AGENT="${1:-}"
TENANT="${2:-studio-molndal}"
[ -n "$AGENT" ] || { echo "Ange agent-id. Det står i URL:en i ElevenLabs."; exit 1; }

[ -f "$HOME/eleven_key.txt" ] && ELEVEN_KEY=$(cat "$HOME/eleven_key.txt")
[ -f "$HOME/mk_secret.txt" ]  && MK_SECRET=$(cat "$HOME/mk_secret.txt")
case "${ELEVEN_KEY:-}" in sk_*) ;; *) echo "Kör först: bash spara-nyckel.sh"; exit 1 ;; esac
[ "${#MK_SECRET}" -eq 64 ] || { echo "MK_SECRET ser fel ut (${#MK_SECRET} tecken)."; exit 1; }

API="https://api.elevenlabs.io/v1/convai"
MK="https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-agent"

echo "Skapar verktyget tidigare_forsaljningar…"
BODY=$(python3 - "$MK/sold_reference" "$MK_SECRET" "$TENANT" <<'PY'
import json, sys
url, hemlis, tenant = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"tool_config": {
  "type": "webhook",
  "name": "tidigare_forsaljningar",
  "description": ("Hämtar bostäder byrån REDAN HAR SÅLT, med slutpris. Använd när någon "
                  "funderar på att sälja och vill veta vad ni gjort i deras område, eller "
                  "frågar vad ni sålt. Ger fakta om genomförda affärer — det är INTE en "
                  "värdering av den som ringer. Läs upp fältet spoken."),
  "response_timeout_secs": 20,
  "api_schema": {
    "url": url, "method": "POST",
    "request_headers": [
      {"type": "static", "name": "Content-Type", "value": "application/json"},
      {"type": "static", "name": "x-mk-secret", "value": hemlis},
      {"type": "static", "name": "x-mk-tenant", "value": tenant}],
    "request_body_schema": {"type": "object", "properties": {
      "area": {"type": "string", "description": "Område eller kommun, till exempel Eklanda"},
      "object_type": {"type": "string", "description": "villa, lagenhet, radhus, fritidshus eller tomt"},
      "min_rooms": {"type": "number", "description": "Minsta antal rum"},
      "min_living_area": {"type": "number", "description": "Minsta boarea i kvadratmeter"},
      "query": {"type": "string", "description": "Fritext, till exempel ett gatunamn"},
      "limit": {"type": "number", "description": "Antal att fa tillbaka, normalt 5"}},
      "required": []}}}}))
PY
)
SVAR=$(curl -s -X POST "$API/tools" -H "xi-api-key: $ELEVEN_KEY" \
  -H "Content-Type: application/json" -d "$BODY")
TOOL_ID=$(printf '%s' "$SVAR" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("id",""))
except Exception: pass' 2>/dev/null)

if [ -z "$TOOL_ID" ]; then
  echo "Misslyckades. Svar från ElevenLabs:"; printf '%s\n' "$SVAR" | head -c 700; echo; exit 1
fi
echo "  ✓ $TOOL_ID"

echo "Hämtar agentens nuvarande verktyg och prompt…"
AG=$(curl -s "$API/agents/$AGENT" -H "xi-api-key: $ELEVEN_KEY")
printf '%s' "$AG" > /tmp/agent_nu.json
python3 - "$TOOL_ID" > /tmp/agent_patch.json <<'PY'
import json, sys
nytt = sys.argv[1]
d = json.load(open("/tmp/agent_nu.json", encoding="utf-8"))
p = d["conversation_config"]["agent"]["prompt"]
ids = list(p.get("tool_ids") or [])
if nytt not in ids:
    ids.append(nytt)

regel = """

## Tidigare försäljningar

När någon funderar på att sälja: använd `tidigare_forsaljningar` FÖRE du erbjuder en
värdering. Att berätta vad ni sålt i deras område, och för hur mycket, är fakta och
helt i sin ordning. Gör det gärna — det är ofta det mest övertygande du kan säga.

Men koppla det aldrig till den som ringer. Aldrig "din bostad borde gå för ungefär
det", aldrig "då ligger du nog kring". Säg vad ni sålt, och boka sedan en riktig
värdering där en mäklare ser bostaden."""

txt = p.get("prompt") or ""
if "tidigare_forsaljningar` FÖRE" not in txt:
    txt = txt.rstrip() + regel
p["prompt"] = txt
p["tool_ids"] = ids
print(json.dumps({"conversation_config": {"agent": {"prompt": p}}}, ensure_ascii=False))
PY

echo "Kopplar verktyget till agenten och uppdaterar prompten…"
SVAR=$(curl -s -X PATCH "$API/agents/$AGENT" -H "xi-api-key: $ELEVEN_KEY" \
  -H "Content-Type: application/json" --data-binary @/tmp/agent_patch.json)
OK=$(printf '%s' "$SVAR" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    t=d.get("conversation_config",{}).get("agent",{}).get("prompt",{}).get("tool_ids",[])
    print(len(t))
except Exception: print("0")' 2>/dev/null)
rm -f /tmp/agent_nu.json /tmp/agent_patch.json

if [ "$OK" -ge 6 ] 2>/dev/null; then
  echo "  ✓ Agenten har nu $OK verktyg."
  echo
  echo "Öppna agenten i ElevenLabs och tryck Publish. Testa sedan:"
  echo "  \"Jag funderar på att sälja mitt radhus i Eklanda. Vad har ni sålt där?\""
else
  echo "  Kopplingen gick inte igenom. Svar:"; printf '%s\n' "$SVAR" | head -c 700; echo
fi
