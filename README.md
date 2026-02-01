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
