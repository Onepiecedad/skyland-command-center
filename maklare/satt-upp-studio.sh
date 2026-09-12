#!/bin/bash
# Sätter upp ElevenLabs-agenten för Studio Fastighetsmäkleri.
# Samma skript som för HusmanHagberg — annan tenant, annat byrånamn.
#
# Kör:
#   bash spara-nyckel.sh      (en gång, för att lägga ElevenLabs-nyckeln på plats)
#   bash satt-upp-studio.sh
#
# Skapar fem nya verktyg mot tenant studio-molndal och en ny agent.
# Befintliga agenter rörs inte.

# Filerna vinner ALLTID över miljön. En ELEVEN_KEY som blivit exporterad med
# skräpvärde i ett tidigare försök ska inte kunna gömma sig bakom en tom-kontroll
# — det kostade oss en halvtimme en gång.
[ -f "$HOME/eleven_key.txt" ] && ELEVEN_KEY=$(cat "$HOME/eleven_key.txt")
[ -f "$HOME/mk_secret.txt" ]  && MK_SECRET=$(cat "$HOME/mk_secret.txt")
export ELEVEN_KEY MK_SECRET

case "${ELEVEN_KEY:-}" in
  sk_*) ;;
  *) echo "ELEVEN_KEY ser inte ut som en nyckel. Kör: bash spara-nyckel.sh"; exit 1 ;;
esac

if [ -z "${ELEVEN_KEY:-}" ]; then
  echo "ELEVEN_KEY saknas. Kör först:  bash spara-nyckel.sh"
  exit 1
fi

export MK_TENANT="studio-molndal"
export MK_BYRA="Studio Fastighetsmäkleri"
exec bash "$(dirname "$0")/satt-upp-agenten.sh"
