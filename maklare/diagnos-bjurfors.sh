#!/bin/bash
# Diagnos: vad svarar bjurfors.se en Supabase Edge Function?
# Kör: MK_SECRET=$(cat ~/mk_secret.txt) bash diagnos-bjurfors.sh
set -u
[ -z "${MK_SECRET:-}" ] && { echo "MK_SECRET saknas."; exit 1; }
curl -s --max-time 120 -X POST \
  "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-bjurfors-debug" \
  -H "Content-Type: application/json" -H "x-mk-secret: $MK_SECRET" \
  -d '{"url":"https://www.bjurfors.se/molndal"}'
echo
