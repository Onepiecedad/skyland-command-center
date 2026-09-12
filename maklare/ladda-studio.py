#!/usr/bin/env python3
# Laddar Studio Fastighetsmäkleris objekt till tenant studio-molndal.
#
# Listsidan bär statusen som css-klass på varje kort (Till_salu / Kommande / Såld),
# så hela beståndet läses av i ETT anrop härifrån. Sen skickas objekten i batchar
# om 12 till edge-funktionen, som hämtar varje objektsida plus Mspecs-fälten.
#
# Kör:  MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-studio.py
#       lägg till "salj" som argument för att hoppa över de sålda
import json, os, re, sys, time, urllib.request

BAS = "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-ingest-studio"
LISTA = "https://studiomakleri.se/till-salu/"
TENANT = "studio-molndal"
BATCH = 12
PAUS = 1.0

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sv-SE,sv;q=0.9",
}
STATUS = {"Till_salu": "till_salu", "Kommande": "kommande", "Såld": "såld"}

hemlis = os.environ.get("MK_SECRET", "")
if not hemlis:
    sys.exit("MK_SECRET saknas. Kör: MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-studio.py")
bara_saljbara = len(sys.argv) > 1 and sys.argv[1] == "salj"

print("→ Läser listsidan …", flush=True)
h = urllib.request.urlopen(urllib.request.Request(LISTA, headers=HEADERS), timeout=90).read().decode("utf-8", "replace")

kort = re.findall(
    r'class="[^"]*\b(Till_salu|Kommande|Såld)\b[^"]*"[\s\S]{0,2500}?href="(https://studiomakleri\.se/till-salu/[^"]+)"', h)
sedda, objekt = set(), []
for klass, url in kort:
    if url in sedda:
        continue
    sedda.add(url)
    objekt.append({"url": url, "status": STATUS[klass]})

raknare = {}
for o in objekt:
    raknare[o["status"]] = raknare.get(o["status"], 0) + 1
print("  %s objekt: %s" % (len(objekt), ", ".join("%s %s" % (v, k) for k, v in sorted(raknare.items()))))

if bara_saljbara:
    objekt = [o for o in objekt if o["status"] != "såld"]
    print("  laddar bara de %s säljbara" % len(objekt))
if not objekt:
    sys.exit("Inga objekt hittades — listsidan kan ha ändrats.")

sedan = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
summa = dict(skrivna=0, visningar=0, oparsbara=0)
misslyckade = []


def kor(bit, sista=False):
    kropp = json.dumps({
        "tenant_slug": TENANT, "objekt": bit, "sista": sista,
        "retire_missing": sista, "retire_since": sedan,
    }).encode()
    r = urllib.request.Request(BAS, data=kropp, headers={
        "Content-Type": "application/json", "x-mk-secret": hemlis})
    try:
        return json.loads(urllib.request.urlopen(r, timeout=300).read().decode())
    except Exception as e:
        detalj = ""
        if hasattr(e, "read"):
            try: detalj = e.read().decode()[:300]
            except Exception: pass
        print("    FEL: %s %s" % (e, detalj), flush=True)
        return None


antal = (len(objekt) + BATCH - 1) // BATCH
for n in range(antal):
    bit = objekt[n * BATCH:(n + 1) * BATCH]
    d = kor(bit)
    if not d or d.get("error") or "urlar" not in d:
        print("  batch %d/%d: %s" % (n + 1, antal,
              json.dumps(d, ensure_ascii=False)[:300] if d else "inget svar"), flush=True)
        misslyckade.extend(o["url"] for o in bit)
    else:
        for k in summa:
            summa[k] += d.get(k, 0)
        misslyckade.extend(d.get("misslyckade_urlar") or [])
        print("  batch %d/%d: %s skrivna, %s visningar%s"
              % (n + 1, antal, d.get("skrivna", 0), d.get("visningar", 0),
                 ", %s MISSLYCKADE" % d["oparsbara"] if d.get("oparsbara") else ""), flush=True)
    time.sleep(PAUS)

if misslyckade:
    igen = sorted(set(misslyckade))
    misslyckade.clear()
    print("\n→ Andra försöket för %s sidor" % len(igen), flush=True)
    for n in range(0, len(igen), 6):
        bit = [{"url": u, "status": next(o["status"] for o in objekt if o["url"] == u)}
               for u in igen[n:n + 6]]
        d = kor(bit)
        if d and "urlar" in d and not d.get("error"):
            for k in summa:
                summa[k] += d.get(k, 0)
            misslyckade.extend(d.get("misslyckade_urlar") or [])
        else:
            misslyckade.extend(u for u in igen[n:n + 6])
        time.sleep(2)

print()
print("SUMMA: %(skrivna)s objekt skrivna, %(visningar)s visningar, "
      "%(oparsbara)s misslyckade" % summa)
if misslyckade:
    print("Kvar misslyckade (%s):" % len(misslyckade))
    for u in misslyckade[:10]:
        print("   ", u)
