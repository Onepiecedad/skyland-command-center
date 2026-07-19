#!/usr/bin/env python3
"""
Patch av n8n-workflowet ig-dm-autosvar: lägger till en parallell SCC-loggnings-
gren (extrakt → username-lookup → POST till SCC) utan att röra autosvars-grenen.
Idempotent: kör inte om noderna redan finns.

Körs lokalt: python3 scripts/patch_igdm_workflow.py
Läser N8N_API_KEY + LEADS_INTAKE_TOKEN/SCC_API_TOKEN ur backend/.env.
"""

import json
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

WF_ID = "nN8u7PE5yP1sY88t"
N8N_BASE = "https://onepiecedad.app.n8n.cloud/api/v1"
SCC_URL = "https://scc.skylandai.se/api/v1/webhooks/ig-dm"

ENV = (Path(__file__).parent.parent / "backend" / ".env").read_text()


def env(key: str) -> str:
    m = re.search(rf"^{key}=(.*)$", ENV, re.M)
    return m.group(1).strip() if m else ""


N8N_KEY = env("N8N_API_KEY")
SCC_TOKEN = env("LEADS_INTAKE_TOKEN") or env("SCC_API_TOKEN")
if not N8N_KEY or not SCC_TOKEN:
    sys.exit("FEL: N8N_API_KEY eller intake-token saknas i backend/.env")


def http(method: str, url: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(url, method=method,
                                 headers={"X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        raise


wf = http("GET", f"{N8N_BASE}/workflows/{WF_ID}")

if any(n["name"] == "SCC-extrakt" for n in wf["nodes"]):
    sys.exit("Redan patchad — SCC-extrakt finns. Inget gjort.")

# Återanvänd IG-token ur befintliga autosvars-noden
handler = next(n for n in wf["nodes"] if n["name"] == "Hantera DM (nyckelord)")
tok = re.search(r"IG_ACCESS_TOKEN = '([^']+)'", handler["parameters"]["jsCode"])
if not tok:
    sys.exit("FEL: hittar inte IG_ACCESS_TOKEN i Hantera DM-noden")
IG_TOKEN = tok.group(1)

extract_code = f"""// SCC-loggning: ALLA meddelanden (inbound + echoes av egna skickade)
const IG_ACCESS_TOKEN = '{IG_TOKEN}';
const out = [];
for (const item of $input.all()) {{
  const body = item.json.body || item.json;
  for (const entry of (body.entry || [])) {{
    for (const ev of (entry.messaging || [])) {{
      const msg = ev.message;
      if (!msg || !msg.text) continue;
      const echo = !!msg.is_echo;
      const other = echo ? (ev.recipient && ev.recipient.id) : (ev.sender && ev.sender.id);
      if (!other) continue;
      out.push({{ json: {{
        ig_id: String(other),
        direction: echo ? 'outbound' : 'inbound',
        text: msg.text,
        mid: msg.mid || '',
        timestamp: ev.timestamp || Date.now(),
        token: IG_ACCESS_TOKEN,
      }} }});
    }}
  }}
}}
return out;"""

payload_code = """// Para ihop username-svaret med ursprungsdatat (indexordning bevaras)
const extr = $('SCC-extrakt').all();
const out = [];
const inp = $input.all();
for (let i = 0; i < inp.length; i++) {
  const resp = inp[i].json || {};
  const src = (extr[i] || {}).json || {};
  if (!src.text) continue;
  out.push({ json: {
    username: resp.username || '',
    direction: src.direction,
    text: src.text,
    mid: src.mid,
    timestamp: src.timestamp,
  } });
}
return out;"""

new_nodes = [
    {
        "name": "SCC-extrakt", "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [420, 620],
        "parameters": {"jsCode": extract_code},
    },
    {
        "name": "Hämta IG-username", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": [640, 620],
        "onError": "continueRegularOutput", "alwaysOutputData": True,
        "parameters": {
            "method": "GET",
            "url": "=https://graph.instagram.com/v23.0/{{ $json.ig_id }}?fields=username&access_token={{ $json.token }}",
            "options": {},
        },
    },
    {
        "name": "Bygg SCC-payload", "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [860, 620],
        "parameters": {"jsCode": payload_code},
    },
    {
        "name": "Logga till SCC", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": [1080, 620],
        "onError": "continueRegularOutput",
        "parameters": {
            "method": "POST",
            "url": SCC_URL,
            "sendHeaders": True,
            "headerParameters": {"parameters": [
                {"name": "Authorization", "value": f"Bearer {SCC_TOKEN}"},
                {"name": "Content-Type", "value": "application/json"},
            ]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": '={{ JSON.stringify({username: $json.username, direction: $json.direction, text: $json.text, mid: $json.mid, timestamp: $json.timestamp}) }}',
            "options": {},
        },
    },
]

for n in new_nodes:
    n["id"] = str(uuid.uuid4())
wf["nodes"].extend(new_nodes)

conns = wf["connections"]
# Parallell gren från webhooken (rör inte autosvars-kopplingen)
conns.setdefault("Webhook DM (POST)", {}).setdefault("main", [[]])
conns["Webhook DM (POST)"]["main"][0].append({"node": "SCC-extrakt", "type": "main", "index": 0})
conns["SCC-extrakt"] = {"main": [[{"node": "Hämta IG-username", "type": "main", "index": 0}]]}
conns["Hämta IG-username"] = {"main": [[{"node": "Bygg SCC-payload", "type": "main", "index": 0}]]}
conns["Bygg SCC-payload"] = {"main": [[{"node": "Logga till SCC", "type": "main", "index": 0}]]}

# n8n:s publika API accepterar bara ett smalt settings-schema — filtrera
ALLOWED_SETTINGS = {"executionOrder", "timezone", "saveDataErrorExecution", "saveDataSuccessExecution",
                    "saveManualExecutions", "saveExecutionProgress", "executionTimeout", "errorWorkflow"}
settings = {k: v for k, v in (wf.get("settings") or {}).items() if k in ALLOWED_SETTINGS}
body = {"name": wf["name"], "nodes": wf["nodes"], "connections": conns, "settings": settings}
http("PUT", f"{N8N_BASE}/workflows/{WF_ID}", body)
print("✅ Workflow patchat: SCC-loggningsgren tillagd (4 noder, parallellt med autosvaret).")
print("   Aktivt:", http("GET", f"{N8N_BASE}/workflows/{WF_ID}").get("active"))
