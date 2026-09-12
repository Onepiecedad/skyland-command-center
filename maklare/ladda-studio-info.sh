#!/bin/bash
# Indexerar Studios info-sidor till vektorlagret så fraga_om_byran har underlag.
# Utan detta svarar agenten "det har jag inget svar på" på allt som inte är ett objekt.
#
# Kör: bash ladda-studio-info.sh
set -u
[ -f "$HOME/mk_secret.txt" ] && MK_SECRET=$(cat "$HOME/mk_secret.txt")
[ -n "${MK_SECRET:-}" ] || { echo "MK_SECRET saknas."; exit 1; }

echo "→ Indexerar sälj-, värderings- och om oss-sidorna. Tar en halv minut."
curl -s --max-time 300 -X POST \
  "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-ingest-docs" \
  -H "Content-Type: application/json" -H "x-mk-secret: $MK_SECRET" \
  -d '{
    "tenant_slug": "studio-molndal",
    "urls": [
      "https://studiomakleri.se/",
      "https://studiomakleri.se/salj-med-oss/",
      "https://studiomakleri.se/fri-vardering/",
      "https://studiomakleri.se/om-oss/",
      "https://studiomakleri.se/kontakt/",
      "https://studiomakleri.se/bevaka-bostad/"
    ],
    "max_urls": 10
  }' | python3 -m json.tool 2>/dev/null || echo "  (kunde inte tolka svaret)"
