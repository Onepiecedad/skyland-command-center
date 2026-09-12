#!/bin/bash
# Sparar ElevenLabs-nyckeln i ~/eleven_key.txt.
#
# Kör:  bash spara-nyckel.sh
#
# Skriv kommandot för hand. Kopierar du det från chatten ligger kommandot i
# urklipp när skriptet ber om nyckeln, och då är det kommandot som sparas.
set -u

printf 'Klistra in ElevenLabs-nyckeln och tryck Enter (den syns inte): '
read -rs NYCKEL
echo
NYCKEL=$(printf %s "$NYCKEL" | tr -d '[:space:]')

if [ "${#NYCKEL}" -lt 20 ] || [ "${NYCKEL#sk_}" = "$NYCKEL" ]; then
  echo
  echo "Det där ser inte ut som en nyckel: ${#NYCKEL} tecken, börjar inte med sk_."
  echo "Inget sparat."
  echo
  echo "Gör så här:"
  echo "  1. Öppna https://elevenlabs.io/app/settings/api-keys"
  echo "  2. Kopiera nyckeln därifrån"
  echo "  3. Skriv 'bash spara-nyckel.sh' för hand och klistra in när den frågar"
  exit 1
fi

printf %s "$NYCKEL" > "$HOME/eleven_key.txt"
chmod 600 "$HOME/eleven_key.txt"
echo "Sparad i ~/eleven_key.txt — ${#NYCKEL} tecken, börjar med ${NYCKEL:0:3}."
echo "Kör nu:  bash satt-upp-studio.sh"
