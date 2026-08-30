# Sajtflöden — skylandai.se → SCC (SCC-48)

> Ersätter n8n-workflows (arkiverade i `docs/n8n-archive/`). Kontrakten mot sajtens JS är
> bevarade 1:1, sajten bytte bara bas-URL. Kod: `backend/src/routes/siteWebhooks.ts`,
> `backend/src/services/siteRag.ts`. Monterat på `/api/v1/webhooks/site` **före** global auth.

## Endpoints

| Route | Anropas av | Auth | Gör |
|---|---|---|---|
| `POST /session-init` | `app/session.js` vid ny session | publik, 60/min | upsert `sessions` (uuid v4, user_agent, entry_module). Svarar `[rad]` (n8n-format). |
| `POST /track-event` | `app/tracker.js` (fetch keepalive) | publik, 60/min | whitelist på 13 eventtyper + datafält, max 25/batch, insert `events`. `{ok:true}`. |
| `POST /session-status` | `app/dashboard.js` polling | publik, 60/min | `{session_uuid, prospect, events[]}` från `prospects` + `interactions`. |
| `POST /void-submission` | `app/void.js` (The Void-formuläret) | publik, 6/min | validera (consent!) → upsert session → insert `prospects` → regelpoäng → RAG → gpt-4o-mini (svensk/engelsk systemprompt) → insert `interactions` → `ingestLead()` in-process → `{status:'success', lead_id, ai_response, best_match_similarity}`. |
| `POST /rag-query` | server-till-server | `X-Skyland-Key` = `SITE_RAG_KEY` \|\| `LEADS_INTAKE_TOKEN` | embeddings + `match_knowledge_base` (tröskel 0.35, topp 3). |
| `POST /voice/signed-url` | `app/voice.js` | publik, 10/min | `{session_uuid, agent_id}` → ElevenLabs get-signed-url med `SITE_ELEVENLABS_API_KEY` \|\| `ELEVENLABS_API_KEY`. |
| `POST /voice/call-ended` | `app/voice.js` efter samtal | publik, 10/min | normalisera → `handleVoiceCallEnded()`: session, prospect-koppling, gpt-4o-mini JSON-extraktion (namn, företag, bransch ur fast kategorilista, mejl, smärtpunkter, mötesönskan, summary), upsert `voice_calls` (provider+external_call_id), insert `interactions`, `ingestLead()`. `{status:'accepted'}`. |
| `POST /voice-call-ended` | ev. extern proxy | token `SITE_VOICE_WEBHOOK_TOKEN` \|\| `LEADS_INTAKE_TOKEN` | samma som ovan, n8n-svarformat. |
| `POST /agent-tools/query_knowledge_base` | ElevenLabs-agenten | `X-Skyland-Key` | RAG. |
| `POST /agent-tools/get_current_time` | ElevenLabs-agenten | `X-Skyland-Key` | nu, tidszon, start/end 7 dagar. |
| `POST /agent-tools/get_available_slots` | ElevenLabs-agenten | `X-Skyland-Key` | Cal.com v2 `/slots`, max 4/dag, `{start,label}`. |
| `POST /agent-tools/book_meeting` | ElevenLabs-agenten | `X-Skyland-Key` | `bookCalcomAppointment()` + activity `voice.booking.created`. Cal.com-webhooken speglar sedan till `bookings`. |

Lead-intaget (`leads.ts`) exporterar `ingestLead()` och `leadIntakeSchema`; sajtflödena anropar
det direkt istället för att göra HTTP mot sig själva.

## CORS

`server.ts` tillåter `https://skylandai.se`, `https://www.skylandai.se`, `https://skyland-ai-os.netlify.app`
(+ `EXTRA_CORS_ORIGINS`, kommaseparerad). Tillåtna headers inkluderar `X-Session-ID` (sajtens `api.js`
skickar den) och `X-Skyland-Key`.

## Sajtens JS (repo Skyland_AI_System, `app/`)

| Fil | Pekar på |
|---|---|
| `session.js`, `tracker.js`, `void.js`, `dashboard.js` | `https://scc.skylandai.se/api/v1/webhooks/site/{session-init,track-event,void-submission,session-status}` |
| `voice.js` | `PROXY_BASE = https://scc.skylandai.se/api/v1/webhooks/site` → `/voice/signed-url`, `/voice/call-ended` |
| `lang.js` | `AGENT_IDS.sv = agent_8301m19fffmqfcv96zgryg5ey3k5`, `AGENT_IDS.en = agent_4501m19h1g8zfq7v6k6hqh642p32` |

## Röstagenterna

Skapas/uppdateras idempotent med `cd backend && python3 scripts/create_site_agent.py` (läser
`ELEVENLABS_API_KEY` + `LEADS_INTAKE_TOKEN` ur `backend/.env`; **kontrollera att de matchar Render**).
Prompter: `scripts/site_agent_prompt.md` (sv, ordagrant från gamla "Alex 4.0 svenska") och
`scripts/site_agent_prompt_en.md` (en). Röster: sv `1Iztu4UHnTb9SUjJcpS1`, en `EXAVITQu4vr4xnSDxMaL`
(ElevenLabs "Sarah"). LLM gpt-4.1-mini, temp 0.3, `eleven_v3_conversational`. Overrides tillåtna för
`first_message` (konversationsstartare) och `language`.

## Verifierat 2026-08-30

Void-formulär end-to-end (RAG-träff 0.56, svenskt svar, poäng, lead i CRM), telemetri från skarpa
sajten, simulerat call-ended (LLM extraherade namn/företag/bransch/mejl/mötesönskan), alla fyra
agent-tools, skarpt röstsamtal (sv) med bokning som landade i Cal.com + SCC-kalendern.
