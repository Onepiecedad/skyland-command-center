# Skyland Command Center - Specifikation v1.1

## Översikt

Skyland Command Center är ett 3D-baserat command center för Skyland Core - multi-tenant kunddrift, automation och agentstyrning. En hexagon-disk som flyter i rymden där varje struktur representerar en modul, agent eller kundinstans.

**Mål med v1:** Bygga Skyland HQ som en fullt fungerande vertikal slice - 3D-byggnad, dashboard-UI, Master Brain agent, databas och workflows. Internt verktyg för operatör (Joakim).

---

## Arkitektur

### Hexagon-disken (The Realm)

```
                     [VOID / RYMDEN]
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        │  ╔═══════════════════════════════╗  │
        │  ║     INTERNAL MODULES          ║  │
        │  ║                               ║  │
        │  ║      ┌───────────┐            ║  │
        │  ║      │ SKYLAND   │            ║  │
        │  ║      │    HQ     │            ║  │  ← BYGGS FÖRST (v1)
        │  ║      └─────┬─────┘            ║  │
        │  ║            │                  ║  │
        │  ║    ┌───────┼───────┐          ║  │
        │  ║    │       │       │          ║  │
        │  ║ [LAB]  [CONTENT] [DEV]        ║  │  ← Silhuetter (v2+)
        │  ║    │       │       │          ║  │
        │  ║    └───┬───┴───┬───┘          ║  │
        │  ║        │       │              ║  │
        │  ║     [COMMS] [ARCHIVE]         ║  │  ← Silhuetter (v2+)
        │  ║                               ║  │
        │  ║      ═══╧═══                  ║  │
        │  ║    [THE STREAM]               ║  │  ← Placeholder (v2+)
        │  ╚═══════════════════════════════╝  │
        │                                     │
        │  ╔═══════════════════════════════╗  │
        │  ║     CUSTOMER REALMS           ║  │
        │  ║                               ║  │
        │  ║  [THOMAS]  [AXEL]  [GUSTAV]   ║  │  ← Silhuetter med status
        │  ║                               ║  │
        │  ║  (skalbart till 20+ kunder)   ║  │
        │  ╚═══════════════════════════════╝  │
        │                                     │
        └─────────────────────────────────────┘
```

### Moduler (komplett lista)

**Internal Modules:**

| Modul | Agent | Status v1 |
|-------|-------|-----------|
| **Skyland HQ** | Master Brain | ✅ Byggs |
| Research Lab | Research Agent | 🔲 Silhuett |
| Content Workshop | Content Agent | 🔲 Silhuett |
| Dev Forge | Dev Agent | 🔲 Silhuett |
| Comms Hub | Comms Agent | 🔲 Silhuett |
| Archive Vault | - | 🔲 Silhuett |
| The Stream | - | 🔲 Placeholder |

**Customer Realms:**

| Modul | Agent | Status v1 |
|-------|-------|-----------|
| Thomas (MarinMekaniker) | Thomas-agent | 🔲 Silhuett |
| Axel (Hasselblads Livs) | Axel-agent | 🔲 Silhuett |
| Gustav (Cold Experience) | Gustav-agent | 🔲 Silhuett |

---

## Tech Stack

| Lager | Teknologi |
|-------|-----------|
| 3D Engine | Three.js / react-three-fiber |
| Frontend UI | React |
| Backend API | Node.js / Express |
| Databas | Supabase (Postgres) |
| Workflows | n8n |
| AI Agent | Clawdbot |
| Röst | ElevenLabs |

---

## V1 Scope: Skyland HQ

### 3D-världen

**Byggs:**
- Hexagon-disk med textur och belysning
- Skyland HQ som färdig 3D-byggnad (klickbar)
- Kamera: orbit, zoom, klick-navigation
- Transition-animation när man klickar in i HQ

**Placeholders:**
- Alla andra strukturer som enkla geometriska former
- Labels med namn
- Kundinstanser har status-indikator (färg) som hämtas från databas (härledd)

**Navigation:**

| Input | Desktop | Mobil |
|-------|---------|-------|
| Rotera disk | Drag | Swipe |
| Zoom | Scroll | Pinch |
| Öppna modul | Klick | Tap |
| Quick menu | Högerklick | Long-press |
| Global command | Cmd+K | Swipe up |


### HQ Dashboard UI

```
┌────────────────────────────────────────────────┐
│  SKYLAND HQ                        [🔊] [⚙️]  │
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────────┐  ┌────────────────────────┐  │
│  │  KUNDER      │  │  MASTER BRAIN          │  │
│  │              │  │                        │  │
│  │  🟢 Thomas   │  │  [Chat/röst-interface] │  │
│  │  🟡 Axel     │  │                        │  │
│  │  🟢 Gustav   │  │  Du: _________________  │  │
│  │              │  │       [🎤] [Send]      │  │
│  └──────────────┘  └────────────────────────┘  │
│                                                │
│  ┌────────────────────────────────────────┐    │
│  │  AKTIVITETSLOGG                        │    │
│  │                                        │    │
│  │  14:32 - Research Agent startade       │    │
│  │          konkurrentanalys (Axel)       │    │
│  │  14:28 - Nytt lead: Thomas pipeline    │    │
│  │  14:15 - Content Agent: utkast klart   │    │
│  └────────────────────────────────────────┘    │
│                                                │
│  [Tillbaka till disken]                        │
└────────────────────────────────────────────────┘
```

**Komponenter:**

| Komponent | Funktion |
|-----------|----------|
| Kundlista | Alla kunder med härledd status (🟢🟡🔴). Klick expanderar: senaste aktivitet, öppna tasks |
| Master Brain Chat | Textinput + skicka-knapp. Visar konversationshistorik |
| Röstknapp | Push-to-talk (håll) eller toggle |
| Aktivitetslogg | Real-time feed. Filtrerbar per agent/kund/typ/severity |
| Röst-toggle | Slå av/på TTS från Master Brain |
| Settings | Autonominivåer, notifikationer |
| Tillbaka-knapp | Återgår till 3D-disken |

---

## Datamodell (Supabase)

### Tabell: customers

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed data
INSERT INTO customers (name, slug) VALUES
  ('Thomas - MarinMekaniker', 'thomas'),
  ('Axel - Hasselblads Livs', 'axel'),
  ('Gustav - Cold Experience', 'gustav');
```

### Tabell: activities

```sql
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  autonomy_level TEXT DEFAULT 'OBSERVE' CHECK (autonomy_level IN ('OBSERVE', 'SUGGEST', 'ACT', 'SILENT')),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_customer ON activities(customer_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_event_type ON activities(event_type);
CREATE INDEX idx_activities_severity ON activities(severity);

-- Event types (examples):
-- lead_created, lead_updated, task_created, task_completed, task_failed
-- workflow_started, workflow_completed, workflow_error
-- message_received, message_sent, agent_action, system_error
```

### Tabell: tasks

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_agent TEXT,
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'assigned', 'in_progress', 'review', 'completed', 'failed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(assigned_agent);
```


### Tabell: messages

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id UUID,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  channel TEXT DEFAULT 'chat' CHECK (channel IN ('chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook')),
  direction TEXT DEFAULT 'internal' CHECK (direction IN ('internal', 'inbound', 'outbound')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_direction ON messages(direction);
```

### Tabell: agent_configs

```sql
CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  autonomy_defaults JSONB DEFAULT '{}',
  triggers JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Master Brain
INSERT INTO agent_configs (agent_name, display_name, description, autonomy_defaults) VALUES
  ('master_brain', 'Master Brain', 'Central koordinator för hela Skyland-systemet', 
   '{"external_output": "SUGGEST", "internal_query": "ACT", "task_creation": "SUGGEST"}');
```

### View: customer_status (HÄRLEDD STATUS)

```sql
CREATE OR REPLACE VIEW customer_status AS
WITH recent_activities AS (
  SELECT 
    customer_id,
    COUNT(*) FILTER (WHERE severity = 'error' AND created_at > now() - interval '24 hours') as errors_24h,
    COUNT(*) FILTER (WHERE severity = 'warn' AND created_at > now() - interval '24 hours') as warnings_24h,
    MAX(created_at) as last_activity
  FROM activities
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
),
pending_tasks AS (
  SELECT 
    customer_id,
    COUNT(*) FILTER (WHERE status IN ('created', 'assigned', 'in_progress', 'review')) as open_tasks,
    COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours') as failed_tasks_24h
  FROM tasks
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
)
SELECT 
  c.id,
  c.name,
  c.slug,
  COALESCE(ra.errors_24h, 0) as errors_24h,
  COALESCE(ra.warnings_24h, 0) as warnings_24h,
  COALESCE(pt.open_tasks, 0) as open_tasks,
  COALESCE(pt.failed_tasks_24h, 0) as failed_tasks_24h,
  ra.last_activity,
  CASE 
    WHEN COALESCE(ra.errors_24h, 0) > 0 OR COALESCE(pt.failed_tasks_24h, 0) > 0 THEN 'error'
    WHEN COALESCE(ra.warnings_24h, 0) > 2 OR COALESCE(pt.open_tasks, 0) > 10 THEN 'warning'
    ELSE 'active'
  END as status
FROM customers c
LEFT JOIN recent_activities ra ON ra.customer_id = c.id
LEFT JOIN pending_tasks pt ON pt.customer_id = c.id;
```

**Status-logik:**
- `error`: Minst 1 error senaste 24h ELLER minst 1 failed task senaste 24h
- `warning`: Mer än 2 warnings senaste 24h ELLER mer än 10 öppna tasks
- `active`: Allt annat (default)

---

## Autonominivåer

| Nivå | Beskrivning | Kräver godkännande |
|------|-------------|-------------------|
| OBSERVE | Agent ser något, loggar det | Nej |
| SUGGEST | Agent föreslår action, väntar på godkännande | Ja |
| ACT | Agent utför action, notifierar efteråt | Nej |
| SILENT | Agent utför action, loggar bara | Nej |

**v1 regler:**

| Action-typ | Autonominivå | Motivering |
|------------|--------------|------------|
| Intern databasquery | ACT | Ingen risk |
| Skapa task | SUGGEST | Operatör ska veta |
| Skicka mail/SMS/WhatsApp | **SUGGEST** | Ett felskick = tappad kund |
| Skapa faktura | **SUGGEST** | Ekonomisk impact |
| Boka/avboka | **SUGGEST** | Kundpåverkande |
| Logga aktivitet | SILENT | Ingen risk |

**Kritisk regel:** Allt som skickar något externt eller påverkar kund direkt → alltid SUGGEST i v1.


---

## API Endpoints

### Base URL: `/api/v1`

### Customers

| Method | Endpoint | Beskrivning |
|--------|----------|-------------|
| GET | `/customers` | Lista alla kunder (använder customer_status view) |
| GET | `/customers/:id` | Hämta en kund med status |
| PUT | `/customers/:id` | Uppdatera kund config |
| GET | `/customers/:id/activities` | Kundens aktivitetslogg |
| GET | `/customers/:id/tasks` | Kundens tasks |

### Activities

| Method | Endpoint | Beskrivning |
|--------|----------|-------------|
| GET | `/activities` | Alla aktiviteter (paginerad, filtrerbar) |
| POST | `/activities` | Logga ny aktivitet |

**Query params för GET /activities:**
- `limit` (default: 50)
- `offset` (default: 0)
- `customer_id` (filter)
- `agent` (filter)
- `event_type` (filter)
- `severity` (filter)
- `since` (timestamp filter)

### Tasks

| Method | Endpoint | Beskrivning |
|--------|----------|-------------|
| GET | `/tasks` | Alla tasks (filtrerbar) |
| POST | `/tasks` | Skapa task |
| PUT | `/tasks/:id` | Uppdatera task |
| PUT | `/tasks/:id/status` | Ändra status |
| POST | `/tasks/:id/approve` | Godkänn SUGGEST-task |

### Messages / Chat

| Method | Endpoint | Beskrivning |
|--------|----------|-------------|
| POST | `/chat` | Skicka meddelande till Master Brain |
| GET | `/chat/history` | Hämta konversationshistorik |

**POST /chat request:**
```json
{
  "message": "Hur går det för Axel?",
  "channel": "chat",
  "conversation_id": "uuid-optional"
}
```

**POST /chat response:**
```json
{
  "response": "Axel har status 'active'. Senaste aktivitet...",
  "conversation_id": "uuid",
  "intent": "STATUS_CHECK",
  "data": { },
  "actions_taken": [
    { "type": "db_query", "target": "customer_status", "details": {} }
  ],
  "proposed_actions": [
    { "type": "create_task", "customer_id": "...", "title": "...", "requires_approval": true }
  ],
  "suggestions": [
    "Vill du se aktivitetsloggen?",
    "Ska jag skapa en uppföljnings-task?"
  ]
}
```

### System

| Method | Endpoint | Beskrivning |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Systemstatus för dashboard |

---

## Master Brain v1 - Kapabiliteter

### Kan göra

| Intent | Exempel | Handling |
|--------|---------|----------|
| STATUS_CHECK | "Hur går det för Axel?" | Hämtar från customer_status view |
| ACTIVITY_QUERY | "Vad hände senaste timmen?" | Filtrerar aktivitetslogg |
| CREATE_TASK | "Researcha konkurrenter till Thomas" | Skapar SUGGEST-task för godkännande |
| DELEGATE | "Be Content Agent skriva ett utkast" | Skapar SUGGEST-task för Content Agent |
| SUMMARY | "Ge mig en briefing" | Sammanfattar status för alla kunder |
| HELP | "Vad kan du göra?" | Visar kapabiliteter |

### Intent-klassificering

```javascript
{
  intent: "STATUS_CHECK",
  entities: {
    customer: "axel"
  },
  confidence: 0.95
}
```

### Response-format

```javascript
{
  response: "Svar till användaren",
  intent: "STATUS_CHECK",
  data: { /* relevant data */ },
  actions_taken: [
    { type: "db_query", target: "customer_status", details: {} }
  ],
  proposed_actions: [
    { type: "create_task", customer_id: "...", title: "...", requires_approval: true }
  ],
  suggestions: ["..."]
}
```


---

## Beacon-system (visuell feedback)

| Färg | Betydelse | Källa |
|------|-----------|-------|
| Pulserande vit | Agent jobbar aktivt | Task med status 'in_progress' |
| Grön glow | Allt OK | customer_status.status = 'active' |
| Gul glow | Behöver attention | customer_status.status = 'warning' |
| Röd glow | Error/kritiskt | customer_status.status = 'error' |
| Blå ring | Väntar på godkännande | Task med autonomy_level = 'SUGGEST' och status = 'review' |

**Implementation:**
- Beacons hämtas från `customer_status` view (härledd, inte manuell)
- HQ-beacon baseras på antal SUGGEST-tasks som väntar på godkännande
- Real-time updates via Supabase subscriptions

---

## Projektstruktur

```
skyland-command-center/
├── SPEC.md                 # Denna fil
├── README.md
│
├── frontend/               # React + Three.js
│   ├── src/
│   │   ├── components/
│   │   │   ├── three/
│   │   │   │   ├── HexagonDisk.tsx
│   │   │   │   ├── SkylandHQ.tsx
│   │   │   │   ├── CustomerRealm.tsx
│   │   │   │   └── Beacon.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── CustomerList.tsx
│   │   │   │   ├── MasterBrainChat.tsx
│   │   │   │   ├── ActivityLog.tsx
│   │   │   │   ├── PendingApprovals.tsx
│   │   │   │   └── Settings.tsx
│   │   │   └── ui/
│   │   ├── hooks/
│   │   │   ├── useCustomers.ts
│   │   │   ├── useActivities.ts
│   │   │   └── useChat.ts
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── stores/
│   │   └── App.tsx
│   ├── public/
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── customers.ts
│   │   │   ├── activities.ts
│   │   │   ├── tasks.ts
│   │   │   └── chat.ts
│   │   ├── services/
│   │   │   ├── masterBrain.ts
│   │   │   └── supabase.ts
│   │   ├── middleware/
│   │   └── index.ts
│   └── package.json
│
├── database/
│   ├── schema.sql          # Alla tabeller + views
│   ├── seed.sql            # Testdata
│   └── migrations/
│
└── docs/
    ├── API.md
    └── AGENTS.md
```

---

## Byggordning

### Fas 1: Foundation
1. [ ] Skapa projektstruktur
2. [ ] Sätt upp Supabase-projekt
3. [ ] Kör schema.sql (inkl. customer_status view)
4. [ ] Kör seed.sql med testdata
5. [ ] Backend: Express server med health endpoint
6. [ ] Backend: CRUD endpoints för customers, activities, tasks

### Fas 2: Master Brain
7. [ ] Integrera Clawdbot
8. [ ] Implementera intent-klassificering
9. [ ] Koppla Master Brain till Supabase
10. [ ] POST /chat endpoint med proposed_actions

### Fas 3: Frontend Shell
11. [ ] React-projekt med Vite
12. [ ] Three.js / react-three-fiber setup
13. [ ] Hexagon-disk med placeholder-strukturer
14. [ ] HQ-byggnad klickbar → transition

### Fas 4: Dashboard UI
15. [ ] CustomerList-komponent (från customer_status view)
16. [ ] ActivityLog-komponent (real-time via Supabase subscription)
17. [ ] MasterBrainChat-komponent
18. [ ] PendingApprovals-komponent (SUGGEST-tasks)

### Fas 5: Integration
19. [ ] Koppla frontend till backend API
20. [ ] Röst-input (Web Speech API)
21. [ ] Röst-output (ElevenLabs)

### Fas 6: Polish & Mobile
22. [ ] Beacon-animationer
23. [ ] Mobil touch-navigation
24. [ ] Performance-optimering


---

## Definition of Done (v1)

### Funktionella krav
- [ ] Kan öppna appen och se hexagon-disken i 3D
- [ ] Kan rotera och zooma disken (desktop + mobil)
- [ ] Kan klicka på HQ och komma in i dashboard
- [ ] Ser lista på kunder med HÄRLEDD status (från view)
- [ ] Kan chatta med Master Brain
- [ ] Master Brain svarar på "Hur går det för [kund]?"
- [ ] Master Brain kan föreslå tasks (SUGGEST)
- [ ] Kan godkänna SUGGEST-tasks via UI
- [ ] Aktivitetslogg uppdateras i real-time
- [ ] Kan filtrera aktivitetslogg på event_type och severity
- [ ] Kan gå tillbaka till disken
- [ ] Fungerar på mobil (touch, 3D-vy)

### Drift-krav
- [ ] All extern output (mail/sms/whatsapp) loggas i activities + messages
- [ ] Varje task har input → output och vem som godkände (audit trail)
- [ ] Extern output kräver SUGGEST + godkännande (aldrig automatiskt i v1)

---

## Framtida versioner

### v2
- Sub-agenter (Research, Content, Dev, Comms) med egen UI
- Proaktiva triggers
- The Stream med real-time data
- Kundinstanser klickbara med egen dashboard

### v3
- Röst-wake ("Hey Skyland")
- Timeline slider (historik)
- Energilinjer mellan strukturer (visar workflow-aktivitet)
- White-label kundvy

---

## Ändringslogg

| Version | Datum | Ändringar |
|---------|-------|-----------|
| 1.0 | 2026-01-31 | Initial spec |
| 1.1 | 2026-01-31 | Clawdbot feedback: Härledd customer_status (view), event_type + severity, SUGGEST för extern output, proposed_actions i API, Three.js istället för Antigravity, drift-krav i DoD, separerade Internal Modules / Customer Realms |

---

*Dokument skapat: 2026-01-31*
*Version: 1.1*
