#!/bin/bash
# Sätter upp ElevenLabs-agenten för Bjurfors Mölndal.
# Samma skript som för HusmanHagberg — bara en annan tenant och ett annat byrånamn.
#
# Kör:
#   read -s ELEVEN_KEY     (API-nyckeln från elevenlabs.io/app/settings/api-keys)
#   read -s MK_SECRET      (om den inte redan är satt)
#   export ELEVEN_KEY MK_SECRET
#   bash satt-upp-bjurfors.sh
#
# Skapar fem NYA verktyg (de pekar på tenant bjurfors-molndal) och en ny agent.
# HusmanHagberg-agenten rörs inte.

[ -f "$HOME/eleven_key.txt" ] && ELEVEN_KEY=$(cat "$HOME/eleven_key.txt")
[ -f "$HOME/mk_secret.txt" ]  && MK_SECRET=$(cat "$HOME/mk_secret.txt")
export ELEVEN_KEY MK_SECRET

export MK_TENANT="bjurfors-molndal"
export MK_BYRA="Bjurfors Mölndal"
exec bash "$(dirname "$0")/satt-upp-agenten.sh"
