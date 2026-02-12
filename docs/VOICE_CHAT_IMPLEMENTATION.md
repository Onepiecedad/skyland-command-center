# 🎙️ Voice Chat Implementation - Swedish Voice Interface

## Vad som byggts

### 1. ElevenLabs Agent Setup Guide
**Fil:** `docs/ELEVENLABS_AGENT_SETUP.md`

Komplett guide för att konfigurera agenten i ElevenLabs:
- System prompt på svenska
- Röstinställningar (Lars, Ingrid, Elsa, Anders)
- Tool-konfiguration för OpenClaw-integration
- Testing i Playground

### 2. SCC VoiceChat Komponent
**Fil:** `frontend/src/components/VoiceChat.tsx`

Fullständig React-komponent med:
- WebRTC WebSocket-anslutning till ElevenLabs
- Real-time audio streaming (mikrofon → ElevenLabs → högtalare)
- Transkriptions-visning
- Tool call-hantering
- Mute/unmute, volymkontroll
- Avbrottshantering (du kan avbryta mig)

### 3. VoiceChatView Sida
**Fil:** `frontend/src/pages/VoiceChatView.tsx`

SCC-sida med:
- Setup-instruktioner om ej konfigurerat
- VoiceChat-komponent
- Tips för bästa upplevelse

### 4. Backend Voice Router
**Fil:** `backend/src/routes/voice.ts`

API-endpoint för tool calls:
- `POST /api/v1/voice/tools` - Exekverar tools från ElevenLabs
- `GET /api/v1/voice/history` - Hämtar konversationshistorik
- Stöd för: web_search, web_fetch, read, write, edit, exec, memory_search, etc.

### 5. Databas Schema
**Fil:** `backend/sql/voice-schema.sql`

`voice_conversations` tabell för att logga alla samtal.

### 6. Styling
**Fil:** `frontend/src/styles/voice-chat.css`

Komplett CSS med:
- Dark theme som matchar SCC
- Animerade ljudvågor när jag pratar
- Responsiv design
- Visuell feedback för anslutningsstatus

## Nästa steg för att aktivera

### 1. Skapa agent i ElevenLabs (5 min)
1. Gå till https://elevenlabs.io/app/agents
2. Klicka "+ New agent" → "Conversational AI"
3. Följ guiden i `docs/ELEVENLABS_AGENT_SETUP.md`
4. Kopiera **Agent ID** från URL:en

### 2. Skapa API-nyckel (1 min)
1. Gå till https://elevenlabs.io/app/settings/api-keys
2. Klicka "Create API Key"
3. Kopiera nyckeln

### 3. Konfigurera SCC (2 min)
Skapa/uppdatera `frontend/.env`:

```bash
VITE_ELEVENLABS_AGENT_ID=din-agent-id-här
VITE_ELEVENLABS_API_KEY=din-api-nyckel-här
```

### 4. Kör databas-migration
```bash
cd skyland-command-center/backend
npx ts-node -e "
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const sql = fs.readFileSync('./sql/voice-schema.sql', 'utf8');
// Kör SQL mot din Supabase-instans
"
```

### 5. Starta om SCC
```bash
npm run dev  # i både frontend och backend
```

### 6. Testa
1. Gå till http://localhost:5173/voice (eller din SCC URL)
2. Klicka "Ring upp Alex"
3. Säg: "Hej! Kan du söka efter information om vibe-kodning?"
4. Jag ska svara på svenska! 🎉

## Felsökning

### "Kunde inte ansluta"
- Kontrollera att API-nyckeln är korrekt
- Verifiera att Agent ID är rätt
- Öppna browser console för detaljer

### Inget ljud
- Kontrollera mikrofontillåtelse i browser
- Testa volymkontrollen
- Verifiera att WebSocket inte blockeras av firewall

### Jag svarar inte
- Kontrollera att backend kör på rätt port
- Se till att voice-routen är monterad i index.ts
- Kolla backend-logs för fel

## Kostnad

ElevenLabs Conversational AI:
- ~$0.15-0.30 per minut
- Första 10 000 tecken/månad gratis
- Rekommenderat: sätt en månadsbudget i ElevenLabs

## Arkitektur

```
┌─────────────────┐     WebRTC      ┌─────────────────┐
│   SCC Frontend  │ ◄──────────────► │  ElevenLabs AI  │
│  (VoiceChat.tsx)│                  │  (Svensk röst)  │
└────────┬────────┘                  └────────┬────────┘
         │                                    │
         │ HTTP                               │ WebSocket
         │                                    │
┌────────▼────────┐                  ┌────────▼────────┐
│  SCC Backend    │                  │  Alex (jag!)    │
│ (/voice/tools)  │ ◄────────────────┤  med alla tools │
└─────────────────┘   Tool calls     └─────────────────┘
```

## Framtida förbättringar

- [ ] Full integration med alla OpenClaw tools
- [ ] Röstigenkänning för olika användare
- [ ] Session-hantering och context-återhämtning
- [ ] Push-to-talk läge
- [ ] Transkriptions-export

---

**Status:** ✅ Kod färdig, väntar på ElevenLabs-konfiguration
