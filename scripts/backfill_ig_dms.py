#!/usr/bin/env python3
"""
Backfill av befintliga IG-konversationer → SCC CRM.

Läser alla trådar via Instagram Graph-API:t (conversations → participants +
messages) och postar varje meddelande genom SCC:s ig-dm-intake, som sköter
kontaktmatchning, dedupe (mid + innehåll) och Contacted→Replied-flytt.
Idempotent: kan köras om när som helst — dubbletter stoppas i intaket.

Körs lokalt: python3 scripts/backfill_ig_dms.py
Kräver: N8N_API_KEY (för IG-token ur workflowet) + intake-token i backend/.env.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GRAPH = "https://graph.instagram.com/v23.0"
SCC_INTAKE = "https://scc.skylandai.se/api/v1/webhooks/ig-dm"
N8N_BASE = "https://onepiecedad.app.n8n.cloud/api/v1"
WF_ID = "nN8u7PE5yP1sY88t"
OWN_USERNAME = "skylandaisystem"
MAX_MSGS_PER_THREAD = 100

ENV = (Path(__file__).parent.parent / "backend" / ".env").read_text()


def env(key: str) -> str:
    m = re.search(rf"^{key}=(.*)$", ENV, re.M)
    return m.group(1).strip() if m else ""


SCC_TOKEN = env("LEADS_INTAKE_TOKEN") or env("SCC_API_TOKEN")
N8N_KEY = env("N8N_API_KEY")
if not SCC_TOKEN or not N8N_KEY:
    sys.exit("FEL: token saknas i backend/.env")


def get(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as r:
        return json.loads(r.read())


def post_scc(payload: dict) -> dict:
    req = urllib.request.Request(
        SCC_INTAKE, method="POST",
        headers={"Authorization": f"Bearer {SCC_TOKEN}", "Content-Type": "application/json"},
        data=json.dumps(payload).encode())
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


# IG-token ur n8n-workflowet (samma källa som autosvaret — en plats, ingen kopia)
wf_req = urllib.request.Request(f"{N8N_BASE}/workflows/{WF_ID}", headers={"X-N8N-API-KEY": N8N_KEY})
with urllib.request.urlopen(wf_req, timeout=30) as r:
    wf = json.loads(r.read())
node = next(n for n in wf["nodes"] if n["name"] == "Hantera DM (nyckelord)")
IG_TOKEN = re.search(r"IG_ACCESS_TOKEN = '([^']+)'", node["parameters"]["jsCode"]).group(1)

# 1. Alla konversationer (paginerat)
convs: list[dict] = []
url = f"{GRAPH}/me/conversations?platform=instagram&limit=25&access_token={IG_TOKEN}"
while url:
    page = get(url)
    convs.extend(page.get("data", []))
    url = (page.get("paging") or {}).get("next")
print(f"{len(convs)} konversationer i inboxen")

stats = {"loggade": 0, "dedupe": 0, "omatchade_trådar": 0, "matchade_trådar": 0}

for conv in convs:
    fields = urllib.parse.quote("participants,messages.limit(" + str(MAX_MSGS_PER_THREAD) + "){id,message,from,created_time}")
    try:
        detail = get(f"{GRAPH}/{conv['id']}?fields={fields}&access_token={IG_TOKEN}")
    except urllib.error.HTTPError as e:
        print(f"  ! kunde inte läsa tråd: {e.code}")
        continue

    parts = (detail.get("participants") or {}).get("data", [])
    other = next((p for p in parts if p.get("username") != OWN_USERNAME), None)
    if not other:
        continue
    username = other["username"]

    msgs = (detail.get("messages") or {}).get("data", [])
    if not msgs:
        continue

    # Äldst först så tidslinjen byggs i rätt ordning
    msgs.sort(key=lambda m: m.get("created_time", ""))

    matched_any = False
    logged = deduped = 0
    for m in msgs:
        text = (m.get("message") or "").strip()
        if not text:
            continue
        direction = "outbound" if (m.get("from") or {}).get("username") == OWN_USERNAME else "inbound"
        try:
            resp = post_scc({
                "username": username,
                "direction": direction,
                "text": text,
                "mid": m.get("id", ""),
                "timestamp": m.get("created_time", ""),
            })
        except urllib.error.HTTPError as e:
            print(f"  ! SCC-fel för @{username}: {e.code}")
            break
        if not resp.get("matched"):
            break  # ingen kontakt i CRM — hoppa hela tråden (privata DM:er ska inte in)
        matched_any = True
        if resp.get("deduped"):
            deduped += 1
        else:
            logged += 1
        time.sleep(0.15)  # snällt tempo mot API:erna

    if matched_any:
        stats["matchade_trådar"] += 1
        stats["loggade"] += logged
        stats["dedupe"] += deduped
        print(f"  ✓ @{username}: {logged} loggade, {deduped} dedupe")
    else:
        stats["omatchade_trådar"] += 1

print(f"\nKLART: {stats['matchade_trådar']} trådar matchade CRM-kort · "
      f"{stats['loggade']} meddelanden loggade · {stats['dedupe']} dubbletter stoppade · "
      f"{stats['omatchade_trådar']} trådar utan kontaktmatch (rördes ej)")
