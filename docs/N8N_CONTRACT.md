# n8n Callback Contract

> **Locked contract** — Changes require updating both backend validation and n8n workflow.

---

## Endpoint

```
POST /api/v1/n8n/task-result
```

**Headers:**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Skyland-Webhook-Secret` | `<secret from .env>` |

---

## Request Schema

```json
{
  "task_id": "<uuid>",
  "run_id": "<uuid>",
  "success": true,
  "output": { "any": "json" },
  "error": "optional error message"
}
```

### Field Rules

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `task_id` | UUID string | ✅ **Yes** | Must match existing task |
| `run_id` | UUID string | ✅ **Yes** | Must match active run for task |
| `success` | boolean | ✅ **Yes** | `true` = completed, `false` = failed |
| `output` | object | No | Include when `success=true` |
| `error` | string | No | Include when `success=false` |

### Validation Errors

Missing required fields returns `400 Bad Request`:

```json
{
  "error": "Validation failed",
  "details": [
    {"path": ["run_id"], "message": "expected string, received undefined"},
    {"path": ["success"], "message": "expected boolean, received undefined"}
  ]
}
```

---

## Response

### Success (200)

```json
{
  "ok": true,
  "task": { "id": "...", "status": "completed", ... }
}
```

### Failure (400/404)

```json
{
  "error": "Task not found"
}
```

---

## Regression Tests

### Prerequisites

```bash
# 1. Backend running
cd backend && npm run dev

# 2. Create test task and get IDs
TASK=$(curl -s -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task","status":"assigned","executor":"n8n:research","customer_id":"3be6465f-dede-4ef0-b6b8-7a3871720cba"}')

TASK_ID=$(echo $TASK | jq -r '.task.id')

# 3. Dispatch to create a run
RUN=$(curl -s -X POST "http://localhost:3001/api/v1/tasks/$TASK_ID/dispatch" \
  -H "Content-Type: application/json" -d '{}')

RUN_ID=$(echo $RUN | jq -r '.run.id')

echo "TASK_ID=$TASK_ID"
echo "RUN_ID=$RUN_ID"
```

### Test: Simulate Success

```bash
curl -X POST http://localhost:3001/api/v1/n8n/task-result \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"success\":true,\"output\":{\"test\":true}}"
```

**Expected:** `200 OK`, task status → `completed`

### Test: Simulate Failure

```bash
curl -X POST http://localhost:3001/api/v1/n8n/task-result \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"run_id\":\"$RUN_ID\",\"success\":false,\"error\":\"test error\"}"
```

**Expected:** `200 OK`, task status → `failed`

### Test: Missing Required Fields

```bash
curl -X POST http://localhost:3001/api/v1/n8n/task-result \
  -H "Content-Type: application/json" \
  -d '{"task_id":"abc"}'
```

**Expected:** `400 Bad Request` with validation errors for `run_id` and `success`

---

## n8n Workflow Reference

See [n8n-workflows/README.md](./n8n-workflows/README.md) for payload mapping details.
