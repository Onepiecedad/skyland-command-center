# n8n Handoff — Critical Fix + Server Hardening (2026-02-09)

> **For:** The Antigravity agent managing n8n.skylandai.se

---

## 🔴 URGENT: Email_IMAP_Ingest is broken

**Workflow ID:** `bzWAZy9HzFu2k-IrE7Thp`
**Status:** Active — failing every 5 minutes (~288 errors/day since ~Jan 28)
**This is the sole cause of the 99.8% failure rate (2028/2032 failures).**

### Root cause

The **"Check Duplicate"** node (Supabase, type `n8n-nodes-base.supabase` v1) is missing the `tableId` parameter. It's configured as `operation: select` but has no table specified.

```
Every 5 Min → Read Unseen Emails → Process Email Data → Check Duplicate 💥
                                                          ↑ "Could not get parameter: tableId"
```

The same issue likely affects **"Insert Message"** node (also Supabase v1, no `tableId`).

### Fix

1. **Deactivate immediately** to stop the error spam:
   - Use n8n MCP: `n8n_deactivate_workflow` with ID `bzWAZy9HzFu2k-IrE7Thp`
   - Or toggle it off in the n8n UI

2. **Fix the Supabase nodes** — set `tableId` on both:
   - `Check Duplicate` (id: `check-dup`) — needs table name for duplicate checking (likely `emails` or `messages`)
   - `Insert Message` (id: `ins-msg`) — needs same table for inserting

3. **Ask Joakim** which Supabase table to use if unclear. Supabase project: `cskhydqmazohmrralglh`

4. **Re-activate** and verify one successful execution

### Workflow purpose

Polls IMAP inbox every 5 min → processes emails (detects partner portals like Offerta/Byggleads) → deduplicates → inserts into Supabase. This is the CRM email ingestion pipeline for MarinMekaniker.

---

## 🔒 Server Hardening

A full server hardening skill has been created at:
📄 `~/clawd/skills/server-hardening/SKILL.md`

**Needs:** The server IP/hostname and SSH credentials for wherever n8n.skylandai.se is hosted. Ask Joakim which provider (Hetzner, DigitalOcean, etc.) and how to access it.

The skill covers: user lockdown, SSH keys, Tailscale, UFW firewall, Fail2Ban, secrets management, monitoring, auto-updates, backups.

---

## Other active workflows (healthy)

| Workflow | Status | Notes |
|----------|--------|-------|
| Skyland Task Approved | ✅ Active | Working fine |
| Marinmekaniker_Formulär_Supabase | ✅ Active | Working fine |
| Email_Outbound_Sender | Inactive | OK (manual trigger) |
| Historical_Email_Import (x3) | Inactive | Old imports, can be deleted |
| Tomt Test Workflow | Inactive | Test, can be deleted |
