# Läser ingest-svaret på stdin. Skriver antingen en rad text, "klar" eller
# "nasta_skip". Ligger i egen fil för att slippa citattecken-helvetet i bash.
import sys, json

rad = sys.stdin.read()
vad = sys.argv[1] if len(sys.argv) > 1 else "text"

try:
    d = json.loads(rad)
except Exception:
    if vad == "text":
        print("OVANTAT SVAR (inte JSON): " + rad[:500])
    elif vad == "klar":
        print("1")          # avbryt hellre än att loopa i blindo
    else:
        print("")
    sys.exit(0)

if vad == "klar":
    print("1" if d.get("klar") or d.get("error") or "urlar" not in d else "0")
    sys.exit(0)
if vad == "nasta":
    print(d.get("nasta_skip", ""))
    sys.exit(0)

if d.get("error"):
    print("FEL: " + str(d["error"]))
    sys.exit(0)

# Saknas urlar är svaret inte vårt — skriv ut det rått i stället för att
# rapportera nollor. Ett skript som visar "0 objekt" när funktionen dog är värre
# än inget skript alls.
if "urlar" not in d:
    print("OVANTAT SVAR frn funktionen:")
    print("    " + json.dumps(d, ensure_ascii=False)[:600])
    sys.exit(0)

g = d.get
delar = [
    "%s sidor" % g("urlar", 0),
    "%s objekt skrivna" % g("skrivna", 0),
    "%s salda hoppade" % g("salda", 0),
    "%s annat kontor" % g("annat_kontor", 0),
    "%s visningar" % g("visningar", 0),
]
if g("oparsbara"):
    delar.append("%s misslyckade sidor" % g("oparsbara"))
print(", ".join(delar))
if g("sitemap_bytes") is not None:
    print("    sitemap: %s tecken, %s traffar pa filtret"
          % (g("sitemap_bytes"), g("totalt_i_sitemap", "?")))
if g("obs"):
    print("    obs: " + str(g("obs")))
if g("kontor_i_urvalet") and not g("skrivna"):
    print("    kontor i urvalet: " + json.dumps(g("kontor_i_urvalet"), ensure_ascii=False))
