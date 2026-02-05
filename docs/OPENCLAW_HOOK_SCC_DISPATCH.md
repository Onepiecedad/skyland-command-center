# OpenClaw Hook: SCC Dispatch

Endpoint specification for SCC → OpenClaw async task dispatch.

## Hook Endpoint

**URL:** `POST /hooks/scc/dispatch`

**Auth:** `Authorization: Bearer <OPENCLAW_HOOK_TOKEN>`

### Request Schema

```json
{
  "task_id": "<uuid>",
  "run_id": "<uuid>",
  "agent_id": "research|prospect-finder|content",
  "prompt": "<task title/instruction>",
  "input": {"any": "optional task input"},
  "customer_id": "<uuid>",
  "callback_url": "https://<scc-host>/api/v1/claw/task-result"
}
```

### Response

```json
{ "status": "accepted" }
```

---

## Callback Contract

After sub-agent completion, OpenClaw POSTs to `callback_url`:

```json
{
  "task_id": "<uuid>",
  "run_id": "<uuid>",
  "success": true,
  "output": {"result": "any JSON"},
  "error": "optional error message"
}
```

- `success=true` → fill `output`
- `success=false` → fill `error`

---

## Agent Mapping

| agent_id        | OpenClaw Agent       |
|-----------------|----------------------|
| research        | research-librarian   |
| prospect-finder | prospect-finder      |
| content         | content              |

---

## Test Commands

### Trigger dispatch (SCC → OpenClaw)

```bash
curl -X POST https://<openclaw-host>/hooks/scc/dispatch \
  -H "Authorization: Bearer <OPENCLAW_HOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "11111111-1111-1111-1111-111111111111",
    "run_id": "22222222-2222-2222-2222-222222222222",
    "agent_id": "research",
    "prompt": "Research marine diesel engines",
    "callback_url": "https://<scc-host>/api/v1/claw/task-result"
  }'
```

### Simulate callback (OpenClaw → SCC)

```bash
curl -X POST http://localhost:3001/api/v1/claw/task-result \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "11111111-1111-1111-1111-111111111111",
    "run_id": "22222222-2222-2222-2222-222222222222",
    "success": true,
    "output": {"summary": "Diesel engines overview..."}
  }'
```

---

## Environment Variables (SCC Backend)

```env
OPENCLAW_HOOK_URL=https://<openclaw-host>/hooks/scc/dispatch
OPENCLAW_HOOK_TOKEN=<secret-token>
SCC_PUBLIC_BASE_URL=https://<public-scc-url>
```

> **Note:** `SCC_PUBLIC_BASE_URL` is used as callback_url base. Falls back to `BACKEND_URL` or `localhost:3001`.
