#!/usr/bin/env python3
"""
drift_check.py — jämför vad prod FAKTISKT kör med vad docs/DRIFT.md påstår.
Stabiliseringsplan fas 1 ("en sanning"). Lärdomen 29 aug: docs och lokal .env
ljög om OUTBOUND_ENABLED och tre skarpa mejl gick ut.

Kollar:
  1. GET /health            → uppe, deployad commit vs lokal main (deploy släpar?)
  2. GET /api/v1/integrations/health → allt som är down/auth_failed
  3. GET /api/v1/integrations/flags  → flaggor + "satt/ej satt" mot tabellen
                                       "Produktionsflaggor" i DRIFT.md
  4. Sekvenser (valfritt, --db): outbound_policy per aktiv sekvens

Körning (från repo-roten, py3.9+ utan beroenden):
  SCC_API_TOKEN=... python3 scripts/drift_check.py
  python3 scripts/drift_check.py --base https://scc.skylandai.se --token ... --json
Exit 0 = ingen drift, 1 = drift, 2 = kunde inte nå prod.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DRIFT_MD = REPO / "docs" / "DRIFT.md"
DEFAULT_BASE = "https://scc.skylandai.se"

# Flaggor i DRIFT.md-tabellen som har ett värde att jämföra (inte bara "satt").
VALUE_FLAGS = {
    "OUTBOUND_ENABLED", "OUTBOUND_MODE", "SEQUENCE_RUNNER_ENABLED", "OUTBOUND_DAILY_LIMIT",
    "TRANSACTIONAL_OUTBOUND_ENABLED", "INTEGRATION_HEALTH_ENABLED",
}
# Zod-defaults när en flagga inte är satt i Render (docs säger "ej satt").
DEFAULTS = {
    "INTEGRATION_HEALTH_ENABLED": "false",
    "TRANSACTIONAL_OUTBOUND_ENABLED": "true",
    "OUTBOUND_MODE": "auto",
}


def parse_drift_md(path: Path) -> dict[str, str]:
    """Läs tabellen under '## Produktionsflaggor'. Returnerar {FLAGGA: förväntat}.
    Rader som '`EMAIL_FROM` / `EMAIL_REPLY_TO`' med värden 'a / b / c' splittas.
    Förväntat värde: backtick-innehåll i kolumn 2, 'satt', 'ej satt' eller råtext."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"^## Produktionsflaggor.*?$\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m:
        sys.exit(f"hittar inte '## Produktionsflaggor' i {path}")
    expected: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if not line.startswith("|") or line.startswith("| Flagga") or line.startswith("|---"):
            continue
        cols = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cols) < 2:
            continue
        names = re.findall(r"`([A-Z0-9_]+)`", cols[0])
        if not names:
            # Raden "Valfria, ej satta | `A`, `B`, ... | ..." — namnen står i kolumn 2.
            if "ej satt" in cols[0].lower():
                for n in re.findall(r"`([A-Z0-9_]+)`", cols[1]):
                    expected[n] = "ej satt"
            continue
        raw_vals = cols[1]
        if raw_vals.startswith("`") and " / " in raw_vals and len(names) > 1:
            vals = [v.strip().strip("`") for v in raw_vals.split(" / ")]
        else:
            vals = [raw_vals.strip("`")] * len(names)
        for n, v in zip(names, vals):
            expected[n] = v
    return expected


def get(base: str, path: str, token: str | None, timeout: float = 20.0) -> tuple[int, dict]:
    req = urllib.request.Request(base.rstrip("/") + path, headers={"Accept": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            body = {}
        return e.code, body
    except Exception as e:  # nätfel
        return 0, {"error": str(e)}


def local_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short=7", "origin/main"], cwd=REPO,
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            return out.stdout.strip()
        out = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"], cwd=REPO,
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else None
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("SCC_BASE_URL", DEFAULT_BASE))
    ap.add_argument("--token", default=os.environ.get("SCC_API_TOKEN"))
    ap.add_argument("--json", action="store_true", help="maskinläsbar utskrift")
    ap.add_argument("--drift-md", default=str(DRIFT_MD))
    args = ap.parse_args()

    findings: list[dict] = []          # {level: 'drift'|'warn'|'info', what, expected, actual}
    def add(level: str, what: str, expected=None, actual=None):
        findings.append({"level": level, "what": what, "expected": expected, "actual": actual})

    # 1. /health
    st, health = get(args.base, "/health", None)
    if st != 200:
        print(f"KAN INTE NÅ {args.base}/health (HTTP {st}) {health.get('error','')}", file=sys.stderr)
        return 2
    deployed = str(health.get("commit") or "")[:7]
    local = local_commit()
    if local and deployed and not (local.startswith(deployed) or deployed.startswith(local)):
        add("warn", "deployad commit ≠ origin/main (deploy pågår eller push saknas?)", local, deployed)
    else:
        add("info", "deployad commit", deployed, deployed)
    add("info", "uptime (s)", None, round(float(health.get("uptime") or 0)))

    if not args.token:
        add("warn", "ingen token (SCC_API_TOKEN / --token) — hoppar över flaggor + integrationshälsa")
    else:
        # 2. integrationshälsa
        st, ih = get(args.base, "/api/v1/integrations/health", args.token, timeout=60)
        if st != 200:
            add("drift", "GET /api/v1/integrations/health", 200, st)
        else:
            for i in ih.get("integrations", []):
                if i.get("status") in ("down", "auth_failed"):
                    add("drift", f"integration {i.get('name')}", "up", f"{i.get('status')} {i.get('detail') or ''}".strip())
                elif i.get("status") == "not_configured":
                    add("info", f"integration {i.get('name')}", None, "not_configured")
            add("info", "integrationshälsa overall", "healthy", ih.get("overall"))

        # 3. flaggor mot DRIFT.md
        expected = parse_drift_md(Path(args.drift_md))
        st, fl = get(args.base, "/api/v1/integrations/flags", args.token)
        if st != 200:
            add("drift", "GET /api/v1/integrations/flags (saknas i deployad version?)", 200, st)
        else:
            flags = {**(fl.get("flags") or {}), **(fl.get("secrets") or {})}
            for name, exp in expected.items():
                if name not in flags:
                    add("warn", f"flagga {name} finns i DRIFT.md men exponeras inte av /flags", exp, None)
                    continue
                act = flags[name]
                if name in VALUE_FLAGS:
                    exp_v = DEFAULTS.get(name, exp) if exp == "ej satt" else exp
                    if str(act).lower() != str(exp_v).lower():
                        add("drift", f"flagga {name}", exp, act)
                elif exp in ("satt", "ej satt"):
                    if act != exp and not (exp == "satt" and act not in ("satt", "ej satt")):
                        add("drift", f"flagga {name}", exp, act)
                else:
                    # textvärde (EMAIL_FROM m.fl.) — jämför exakt
                    if str(act or "").strip() != exp.strip():
                        add("drift", f"flagga {name}", exp, act)
            for name in flags:
                if name not in expected:
                    add("info", f"flagga {name} saknas i DRIFT.md", None, flags[name])

    drift = [f for f in findings if f["level"] == "drift"]
    warns = [f for f in findings if f["level"] == "warn"]
    if args.json:
        print(json.dumps({"base": args.base, "drift": drift, "warnings": warns,
                          "info": [f for f in findings if f["level"] == "info"]}, ensure_ascii=False, indent=2))
    else:
        print(f"drift_check mot {args.base}")
        for f in findings:
            tag = {"drift": "DRIFT", "warn": "VARN ", "info": "ok   "}[f["level"]]
            exp = f"förväntat {f['expected']!r}" if f["expected"] is not None else ""
            act = f"faktiskt {f['actual']!r}" if f["actual"] is not None else ""
            print(f"  [{tag}] {f['what']}  {exp}  {act}".rstrip())
        print(f"\n{len(drift)} drift, {len(warns)} varningar")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
