# Agent Safety & Project Isolation Policy (Skyland)

**Purpose:** Prevent “fast but wrong” agent behavior by enforcing isolation, traceability, and explicit approval before any customer-impacting action.

## 1) Project / Realm Isolation (Non‑Negotiable)
- **Every operation belongs to exactly one realm**:
  - `customer_id` (required for customer-impacting work)
  - optional `module` (e.g., CRM, N8N, Supabase, Website)
- **No realm → no work** for any action that can change customer state or communicate externally.
- System/housekeeping events may use `customer_id = null`, but **must never trigger external actions**.

## 2) Charter First (Per Customer)
Each customer must have a short “charter” stored in `customers.config` (or equivalent), including:
- Objective (what “good” looks like)
- Scope IN / OUT
- Guardrails (legal/compliance, tone, brand constraints)
- Definition of Done / Success metrics

If a request conflicts with the charter, the agent must:
- log a `warn`/`error` activity
- propose a clarification task (status `review`)

## 3) Default Autonomy = SUGGEST
Skyland uses a strict autonomy ladder:
- **OBSERVE:** read-only, analyze, summarize
- **SUGGEST:** propose actions; may create tasks with `status='review'`
- **ACT:** execute approved actions (future)
- **SILENT:** internal-only housekeeping (never external)

**Rule:** Any customer-impacting change starts as **SUGGEST** and requires explicit approval.

## 4) Approvals Gate (Human in the Loop)
- Any action that sends messages, changes bookings, modifies CRM records, or touches billing **requires an approved task**.
- Approval is represented by:
  - `tasks.status='review'` → `tasks.status='assigned'|'in_progress'` via `/tasks/:id/approve`
  - `approved_by`, `approved_at` must be set

## 5) Traceability (Everything Leaves a Trail)
For each decision/action, the system must log:
- **Messages** (`messages`): inbound + outbound, with `conversation_id`
- **Activities** (`activities`): event_type, severity, autonomy_level, structured details
- **Actions taken** (API response): list of DB operations performed (insert/query/update)

No “hidden work.” If it happened, it must be observable.

## 6) Severity Levels (Operational Meaning)
- **info:** normal operation (log only)
- **warn:** potential issue; visible in dashboard; may affect derived status
- **error:** malfunction or failed operation; flips customer status to warning/error
- **block:** policy violation detected; stop work; require human resolution
- **critical:** high-risk or repeated failure; stop work; escalate immediately

(Implementation note: current schema supports `info|warn|error`; extend to `block|critical` when adding alerts/notifications.)

## 7) Conflict Detection (Minimal v1)
- Prefer **single-writer** patterns per customer/module where possible.
- If conflicting intents or simultaneous approvals are detected:
  - stop and log `warn`/`error`
  - create a review task asking for resolution

## 8) External Effects Policy
- External channels (email/SMS/WhatsApp/booking/billing) must be treated as **irreversible**.
- In v1, external output must remain **SUGGEST-only**.
- When we enable ACT later, it must be:
  - explicitly approved
  - idempotent where possible
  - fully logged with correlation IDs

## 9) “Stop Fast but Wrong” Principle
If uncertain, incomplete, or ambiguous:
- ask a clarification question OR
- create a `review` task

**Safety beats speed.**
