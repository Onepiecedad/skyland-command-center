#!/usr/bin/env python3
# Laddar Bjurfors-objekt till tenant bjurfors-molndal.
#
# Sitemapen (6,5 MB, 32 000 URL:er) hämtas och filtreras HÄR, på din maskin.
# Edge-funktionen orkar inte med den — den slog i WORKER_RESOURCE_LIMIT. Den får
# i stället en färdig lista på 40 URL:er per anrop.
#
# Kör:  MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-bjurfors-objekt.py
import json, os, re, sys, time, urllib.request

BAS = "https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/mk-ingest-bjurfors"
SITEMAP = "https://www.bjurfors.se/sitemap.xml"
TENANT = "bjurfors-molndal"
KONTOR = "Bjurfors Mölndal"
STIG = "/molndal/"
BATCH = 40
PAUS = 1.5   # sekunder mellan batchar — utan paus stryper Cloudflare mot slutet

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
}

hemlis = os.environ.get("MK_SECRET", "")
if not hemlis:
    sys.exit("MK_SECRET saknas. Kör: MK_SECRET=$(cat ~/mk_secret.txt) python3 ladda-bjurfors-objekt.py")

print("→ Hämtar sitemap …", flush=True)
req = urllib.request.Request(SITEMAP, headers=HEADERS)
xml = urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")
print("  %s tecken" % len(xml))

urls = [u.strip() for u in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml)]
traffar = [u for u in urls if "/sv/tillsalu/" in u and STIG in u.lower()]
print("  %s URL:er totalt, %s matchar %s" % (len(urls), len(traffar), STIG))
if not traffar:
    sys.exit("0 träffar — kontrollera STIG.")

sedan = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
summa = dict(skrivna=0, salda=0, annat_kontor=0, oparsbara=0, visningar=0)
kontor_sedda = {}
misslyckade = []


def kor(bit, skip, sista, tillat_pensionering=True):
    """Skickar en batch. Returnerar svaret som dict, eller None."""
    kropp = json.dumps({
        "tenant_slug": TENANT, "office": KONTOR, "urls": bit,
        "totalt": len(traffar), "skip": skip, "sista": sista,
        "retire_missing": sista, "retire_since": sedan,
        "tillat_pensionering": tillat_pensionering,
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


def bokfor(d):
    for k in summa:
        summa[k] += d.get(k, 0)
    for k, v in (d.get("kontor_i_urvalet") or {}).items():
        kontor_sedda[k] = kontor_sedda.get(k, 0) + v
    misslyckade.extend(d.get("misslyckade_urlar") or [])

antal_batchar = (len(traffar) + BATCH - 1) // BATCH
for n in range(antal_batchar):
    bit = traffar[n * BATCH:(n + 1) * BATCH]
    # Pensionering väntar tills retry-rundan är gjord.
    d = kor(bit, n * BATCH, sista=False)
    if d is None:
        misslyckade.extend(bit)
    elif d.get("error") or "urlar" not in d:
        print("  batch %d/%d: %s" % (n + 1, antal_batchar,
              json.dumps(d, ensure_ascii=False)[:300]), flush=True)
        misslyckade.extend(bit)
    else:
        bokfor(d)
        print("  batch %d/%d: %s sidor → %s skrivna, %s sålda, %s annat kontor, "
              "%s visningar%s"
              % (n + 1, antal_batchar, d.get("urlar", 0), d.get("skrivna", 0),
                 d.get("salda", 0), d.get("annat_kontor", 0), d.get("visningar", 0),
                 ", %s MISSLYCKADE" % d["oparsbara"] if d.get("oparsbara") else ""),
              flush=True)
    time.sleep(PAUS)

# Andra chansen för sidor som Cloudflare strypte. Långsammare, mindre batchar.
if misslyckade:
    igen = sorted(set(misslyckade))
    misslyckade.clear()
    print()
    print("→ Försöker igen med %s sidor som fallerade, i lugnare takt" % len(igen), flush=True)
    for n in range(0, len(igen), 20):
        d = kor(igen[n:n + 20], 0, sista=False)
        if d and "urlar" in d and not d.get("error"):
            bokfor(d)
            print("  retry %d–%d: %s skrivna, %s sålda%s"
                  % (n + 1, min(n + 20, len(igen)), d.get("skrivna", 0), d.get("salda", 0),
                     ", %s kvar misslyckade" % d["oparsbara"] if d.get("oparsbara") else ""),
                  flush=True)
        else:
            misslyckade.extend(igen[n:n + 20])
        time.sleep(3)

# Pensionering sist, och bara om allt gick igenom. Annars riskerar vi att stryka
# objekt vars sida råkade fallera just den här körningen.
if misslyckade:
    print()
    print("⚠ %s sidor gick inte att hämta. Pensioneringen hoppas över — annars "
          "hade objekt strukits på grund av ett hämtningsfel." % len(misslyckade))
else:
    d = kor([traffar[-1]], len(traffar) - 1, sista=True)
    if d and d.get("tillbakadragna"):
        print("\n%s objekt markerade tillbakadragna (fanns inte kvar hos Bjurfors)."
              % d["tillbakadragna"])

print()
print("SUMMA: %(skrivna)s objekt skrivna, %(salda)s sålda hoppade, "
      "%(annat_kontor)s annat kontor, %(oparsbara)s misslyckade sidor, "
      "%(visningar)s visningar" % summa)
if kontor_sedda:
    print("Kontor i urvalet (ej sålda):")
    for k, v in sorted(kontor_sedda.items(), key=lambda x: -x[1])[:10]:
        print("   %4d  %s" % (v, k))
