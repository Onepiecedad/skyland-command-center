# Skyland Command Center

Central dashboard for managing the Skyland ecosystem.

## Getting Started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend

# Copy environment template and fill in your Supabase credentials
cp .env.example .env
# Edit .env with your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

npm install
npm run dev
```

### Environment Variables

The backend requires the following environment variables (see `backend/.env.example`):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for server-side access |
| `PORT` | Server port (default: 3001) |

**⚠️ Never commit `.env` to git** – it's already in `.gitignore`.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/customers` | Get all customers with status |
| `POST` | `/api/v1/activities` | Create a new activity |

### Example Requests

```bash
# Health check
curl http://localhost:3001/api/v1/health

# Get customers with status
curl http://localhost:3001/api/v1/customers

# Create activity
curl -X POST http://localhost:3001/api/v1/activities \
  -H "Content-Type: application/json" \
  -d '{"agent": "test_agent", "action": "test_action", "event_type": "test"}'
```

---

## Test Checklist

### 1. Starta backend + frontend

```bash
# Terminal 1 – Backend
cd backend && npm run dev

# Terminal 2 – Frontend
cd frontend && npm run dev
```

### 2. Verifiera `/health` och `/status`

```bash
curl http://localhost:3001/api/v1/health
# ✅ Förväntat: { "status": "ok", "supabase": { "ok": true } }

curl http://localhost:3001/api/v1/status
# ✅ Förväntat: time, supabase.ok, counts (customers, tasks_open, suggest_pending)
```

### 3. Testa `/chat` (skapa SUGGEST-task)

```bash
curl -X POST http://localhost:3001/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "skapa en uppgift för axel", "channel": "web"}'
# ✅ Förväntat: response med proposed_actions innehållande en task i status 'review'
```

### 4. Approve task

- [ ] Öppna dashboard: `http://localhost:5174/`
- [ ] "Pending Approvals" visar den nya tasken
- [ ] Klicka **Approve** → tasken försvinner från listan

### 5. Se att ActivityLog uppdateras

- [ ] ActivityLog visar ny rad med `task.approved` eller liknande

### 6. Klicka på kund i 3D-vy

- [ ] Hovra över en sfär → tooltip visas (name, slug, open_tasks)
- [ ] Klicka på sfär → "Filtering: [slug]" visas i header
- [ ] ActivityLog och PendingApprovals filtreras på vald kund

### 7. Verifiera beacon-färger

| Status   | Förväntad färg |
|----------|----------------|
| `active` | 🟢 Grön        |
| `warning`| 🟠 Orange      |
| `error`  | 🔴 Röd         |

---

✅ **Alla steg klara = MVP fungerar!**
