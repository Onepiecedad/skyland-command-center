#!/bin/bash
# Laddar Bjurfors Mölndal — objekt + kunskapsbas — till tenant "bjurfors-molndal".
#
# Kör:
#   read -s MK_SECRET      (klistra in nyckeln, Enter)
#   bash ladda-bjurfors.sh
#
# Objekten hämtas i omgångar om 200 sidor. Bjurfors stryper vid för hög
# parallellitet, så det tar ett par minuter. Varje omgång skrivs ut.

set -u
BAS="https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1"
TENANT="bjurfors-molndal"
KONTOR="Bjurfors Mölndal"
STIG="/molndal/"
HJALP="$(cd "$(dirname "$0")" && pwd)/bj_svar.py"
# "bash ladda-bjurfors.sh objekt" hoppar kunskapsbasen (den är redan indexerad).
BARA="${1:-allt}"

if [ -z "${MK_SECRET:-}" ]; then echo "MK_SECRET saknas. Kör: read -s MK_SECRET"; exit 1; fi
command -v python3 >/dev/null || { echo "python3 saknas."; exit 1; }
[ -f "$HJALP" ] || { echo "bj_svar.py saknas bredvid det här skriptet."; exit 1; }

# Samma tidsstämpel i alla omgångar — annars pensioneras objekt som just laddats.
SEDAN=$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'))")

echo "→ Objekt från $KONTOR"
SKIP=0
for OMGANG in 1 2 3 4 5; do
  SVAR=$(curl -s --max-time 300 -X POST "$BAS/mk-ingest-bjurfors" \
    -H "Content-Type: application/json" -H "x-mk-secret: $MK_SECRET" \
    -d "{\"tenant_slug\":\"$TENANT\",\"office\":\"$KONTOR\",\"path_match\":\"$STIG\",\"skip\":$SKIP,\"max_urls\":200,\"retire_since\":\"$SEDAN\"}")

  printf '  omgång %s: ' "$OMGANG"
  printf '%s' "$SVAR" | python3 "$HJALP" text

  KLAR=$(printf '%s' "$SVAR" | python3 "$HJALP" klar)
  NASTA=$(printf '%s' "$SVAR" | python3 "$HJALP" nasta)
  [ "$KLAR" = "1" ] && break
  [ -z "$NASTA" ] && break
  SKIP="$NASTA"
done

if [ "$BARA" = "objekt" ]; then
  echo
  echo "Klart (bara objekt). Läs siffrorna ovan."
  exit 0
fi

echo
echo "→ Kunskapsbas (sälj-, köp- och värderingssidor + Mölndalskontoret)"
echo "  Embeddings kostar några ören. Tar en minut."
curl -s --max-time 300 -X POST "$BAS/mk-ingest-docs" \
  -H "Content-Type: application/json" -H "x-mk-secret: $MK_SECRET" \
  -d '{
    "tenant_slug": "bjurfors-molndal",
    "urls": [
      "https://www.bjurfors.se/molndal",
      "https://www.bjurfors.se/sv/salja/salj-bostad-med-bjurfors-maklare/",
      "https://www.bjurfors.se/sv/salja/salja-lagenhet-bostadsratt/",
      "https://www.bjurfors.se/sv/salja/salja-hus/",
      "https://www.bjurfors.se/sv/salja/boka-vardering/vardera-bostad/",
      "https://www.bjurfors.se/sv/salja/boka-vardering/vardera-lagenhet/",
      "https://www.bjurfors.se/sv/salja/boka-vardering/skriftlig-bostadsvardering/",
      "https://www.bjurfors.se/sv/kopa/kopguide/",
      "https://www.bjurfors.se/sv/kopa/kopa-lagenhet/",
      "https://www.bjurfors.se/sv/kopa/kopa-bostadsratt/",
      "https://www.bjurfors.se/sv/kopa/kopa-hus/",
      "https://www.bjurfors.se/sv/kopa/kopa-pa-forhand/",
      "https://www.bjurfors.se/sv/kopa/bjurforsmetoden/",
      "https://www.bjurfors.se/sv/kopa/kundvagledare/",
      "https://www.bjurfors.se/sv/kopa/besiktigad/besiktigad-for-din-villaaffar/",
      "https://www.bjurfors.se/sv/kopa/besiktigad/besiktigad-for-din-bostadsrattsaffar/",
      "https://www.bjurfors.se/sv/sidor/fastighetsmaklarlag/",
      "https://www.bjurfors.se/sv/om-oss/vara-kontor/bjurfors-sverige/"
    ],
    "max_urls": 30
  }' | python3 -m json.tool 2>/dev/null || echo "  (kunde inte tolka svaret)"

echo
echo "Klart. Läs siffrorna ovan innan du visar något för någon."
