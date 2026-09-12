#!/bin/bash
# Kollar om ElevenLabs-nyckeln i ~/eleven_key.txt är giltig och har rätt behörighet.
# Kör: bash kolla-nyckel.sh
set -u
F="$HOME/eleven_key.txt"
[ -f "$F" ] || { echo "~/eleven_key.txt saknas. Kör: bash spara-nyckel.sh"; exit 1; }
K=$(cat "$F")
echo "Nyckel: ${#K} tecken, börjar med ${K:0:3}"
echo

echo "1) Är nyckeln giltig alls?  (GET /v1/user)"
SVAR=$(curl -s -w '\n%{http_code}' -H "xi-api-key: $K" https://api.elevenlabs.io/v1/user)
KOD=$(printf '%s' "$SVAR" | tail -1)
KROPP=$(printf '%s' "$SVAR" | sed '$d')
echo "   HTTP $KOD"
if [ "$KOD" = "200" ]; then
  printf '%s' "$KROPP" | python3 -c '
import sys, json
d = json.load(sys.stdin)
s = d.get("subscription") or {}
print("   Konto:", d.get("first_name") or d.get("xi_api_key") and "(inloggad)" or "?")
print("   Plan: ", s.get("tier"), "| tecken kvar:", s.get("character_limit", 0) - s.get("character_count", 0))
' 2>/dev/null || echo "   (kunde inte tolka svaret)"
else
  echo "   Nyckeln är ogiltig eller återkallad."
  printf '   %s\n' "$(printf '%s' "$KROPP" | head -c 200)"
  echo
  echo "   Gör en ny på https://elevenlabs.io/app/settings/api-keys"
  echo "   och kör: bash spara-nyckel.sh"
  exit 1
fi
echo

echo "2) Har den behörighet för Agents/Conversational AI?  (GET /v1/convai/agents)"
SVAR=$(curl -s -w '\n%{http_code}' -H "xi-api-key: $K" "https://api.elevenlabs.io/v1/convai/agents?page_size=1")
KOD=$(printf '%s' "$SVAR" | tail -1)
KROPP=$(printf '%s' "$SVAR" | sed '$d')
echo "   HTTP $KOD"
if [ "$KOD" = "200" ]; then
  echo "   Läsbehörighet finns."
else
  echo "   Nekad. Nyckeln saknar behörighet för Conversational AI."
  printf '   %s\n' "$(printf '%s' "$KROPP" | head -c 300)"
  echo
  echo "   Fixa så här: elevenlabs.io → Settings → API Keys → redigera nyckeln"
  echo "   och sätt Conversational AI (Agents) till Read + Write."
  echo "   Enklast är att skapa en ny nyckel med full access."
  exit 1
fi
echo

echo "3) Får den skapa saker?  (POST /v1/convai/tools, testverktyg)"
SVAR=$(curl -s -w '\n%{http_code}' -X POST "https://api.elevenlabs.io/v1/convai/tools" \
  -H "xi-api-key: $K" -H "Content-Type: application/json" \
  -d '{"tool_config":{"type":"webhook","name":"skyland_test_radera_mig","description":"Tillfälligt test, kan raderas.","response_timeout_secs":5,"api_schema":{"url":"https://example.com/","method":"GET"}}}')
KOD=$(printf '%s' "$SVAR" | tail -1)
KROPP=$(printf '%s' "$SVAR" | sed '$d')
echo "   HTTP $KOD"
if [ "$KOD" = "200" ] || [ "$KOD" = "201" ]; then
  ID=$(printf '%s' "$KROPP" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("id",""))
except Exception: pass' 2>/dev/null)
  echo "   Skrivbehörighet finns. Testverktyg: $ID"
  if [ -n "$ID" ]; then
    curl -s -X DELETE "https://api.elevenlabs.io/v1/convai/tools/$ID" -H "xi-api-key: $K" >/dev/null
    echo "   Testverktyget raderat igen."
  fi
  echo
  echo "Allt grönt. Kör:  bash satt-upp-studio.sh"
else
  if [ "$KOD" = "401" ] || [ "$KOD" = "403" ]; then
    echo "   Nekad — nyckeln saknar skrivbehörighet för Conversational AI."
  else
    echo "   Skrivningen gick inte igenom, men det är inte ett behörighetsfel."
    echo "   HTTP $KOD betyder att anropet var felformat, inte att nyckeln är fel."
  fi
  printf '   %s\n' "$(printf '%s' "$KROPP" | head -c 300)"
  echo
  echo "   Nyckeln får läsa men inte skapa. Sätt Conversational AI till Write,"
  echo "   eller gör en ny nyckel med full access."
fi
