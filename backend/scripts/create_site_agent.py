#!/usr/bin/env python3
"""
SCC-48: Skapar sajtens röstagent "Alex (skylandai.se)" i SCC:s ElevenLabs-konto,
med fyra webhook-verktyg som pekar på SCC (/api/v1/webhooks/site/agent-tools/*).

Ersätter agenten "Alex 4.0 svenska" (agent_8701…) som låg i ett annat konto.
Kör: python3 scripts/create_site_agent.py   (läser ELEVENLABS_API_KEY + LEADS_INTAKE_TOKEN ur backend/.env)
Prompten läses från scripts/site_agent_prompt.md. Idempotent: uppdaterar om namnet redan finns.
"""
import json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
for line in open(os.path.join(ROOT, '.env')):
    m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?', line)
    if m: env[m.group(1)] = m.group(2).strip()
KEY = env['ELEVENLABS_API_KEY']; TOKEN = env['LEADS_INTAKE_TOKEN']
BASE = 'https://scc.skylandai.se/api/v1/webhooks/site/agent-tools'

def api(method, path, body=None):
    req = urllib.request.Request('https://api.elevenlabs.io' + path, method=method,
        headers={'xi-api-key': KEY, 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, path, e.read().decode()[:800]); sys.exit(1)

def webhook_tool(name, description, props, required, timeout=20):
    return {'tool_config': {
        'type': 'webhook', 'name': name, 'description': description, 'response_timeout_secs': timeout,
        'api_schema': {
            'url': f'{BASE}/{name}', 'method': 'POST',
            'request_headers': {'X-Skyland-Key': TOKEN, 'Content-Type': 'application/json'},
            'request_body_schema': {'type': 'object', 'description': description, 'required': required,
                'properties': {k: {'type': 'string', 'description': v} for k, v in props.items()}},
        }}}

TOOLS = [
    webhook_tool('query_knowledge_base',
        'Söker Skylands kunskapsbas efter branschspecifikt innehåll, tjänster, priser, processer och case studies. Använd när besökaren beskrivit sin situation. Sammanfatta i naturligt tal, läs aldrig chunks ordagrant. Om best_similarity < 0.4: säg att vi återkommer med konkreta detaljer.',
        {'query': 'Besökarens situation/behov som sökfråga, på svenska. Inkludera bransch och problem.'}, ['query']),
    webhook_tool('get_current_time',
        'Hämtar dagens datum, klockslag och tidszon (Europe/Stockholm) plus start/end för de kommande 7 dagarna. Anropa innan get_available_slots.',
        {'reason': 'Kort varför tiden behövs (valfritt)'}, []),
    webhook_tool('get_available_slots',
        'Hämtar lediga tider för ett kostnadsfritt 15-minuters videosamtal. Returnerar högst fyra tider per dag. Anropa med start/end från get_current_time. Föreslå två tider som matchar besökarens preferens.',
        {'start': 'ISO 8601-starttid för sökfönstret (från get_current_time.start)', 'end': 'ISO 8601-sluttid för sökfönstret (från get_current_time.end)'}, []),
    webhook_tool('book_meeting',
        'Bokar videosamtalet i kalendern. Anropa ENDAST när både tiden och e-postadressen bekräftats högt av besökaren. Använd exakt start-värdet från get_available_slots.',
        {'name': 'Besökarens fullständiga namn', 'email': 'Bekräftad e-postadress (läs tillbaka bokstav för bokstav först)', 'start': 'Vald tid, exakt start-värdet från get_available_slots (ISO 8601)',
         'phone': 'Telefonnummer om besökaren gav ett', 'notes': 'Kort sammanfattning: företag, bransch, problem'}, ['name', 'email', 'start'], timeout=30),
]

existing = {t['tool_config']['name']: t['id'] for t in api('GET', '/v1/convai/tools').get('tools', [])}
tool_ids = []
for t in TOOLS:
    name = t['tool_config']['name']
    if name in existing:
        api('PATCH', f"/v1/convai/tools/{existing[name]}", t); tid = existing[name]; print('uppdaterade verktyg', name, tid)
    else:
        tid = api('POST', '/v1/convai/tools', t)['id']; print('skapade verktyg', name, tid)
    tool_ids.append(tid)

def agent_config(prompt_file, first, lang, voice_id):
    prompt = open(os.path.join(ROOT, 'scripts', prompt_file), encoding='utf-8').read()
    return {
        'agent': {
            'first_message': first, 'language': lang,
            # Sajten skickar besökarkontext som dynamiska variabler när formuläret
            # redan är skickat. Tomma defaults gör vanliga samtal opåverkade.
            'dynamic_variables': {'dynamic_variable_placeholders': {
                'visitor_context': '', 'visitor_name': '', 'visitor_company': '',
                'visitor_message': '', 'ai_answer': ''}},
            'prompt': {
                'prompt': prompt, 'llm': 'gpt-4.1-mini', 'temperature': 0.3, 'tool_ids': tool_ids,
                'built_in_tools': {
                    'end_call': {'type': 'system', 'name': 'end_call', 'description': 'End the call politely when the conversation has naturally concluded.', 'params': {'system_tool_type': 'end_call'}},
                    'language_detection': {'type': 'system', 'name': 'language_detection', 'description': '', 'params': {'system_tool_type': 'language_detection'}},
                },
            },
        },
        'tts': {'voice_id': voice_id, 'model_id': 'eleven_v3_conversational', 'stability': 0.45, 'similarity_boost': 0.75},
    }

# Sajten skickar overrides.agent.firstMessage (konversationsstartare) + language → måste vara tillåtet.
platform_settings = {'overrides': {'conversation_config_override': {'agent': {'first_message': True, 'language': True}}}}

AGENTS = [
    # Svenska: samma röst som gamla "Alex 4.0 svenska".
    ('Alex (skylandai.se)', agent_config('site_agent_prompt.md',
        'Välkommen till Skyland — du pratar med vår AI-assistent och samtalet sparas. Vad kan jag hjälpa dig med idag?', 'sv', '1Iztu4UHnTb9SUjJcpS1')),
    # Engelska: samma röst som gamla "Alex 4.0 English" (ElevenLabs premade "Sarah", finns i alla konton).
    ('Alex (skylandai.se, EN)', agent_config('site_agent_prompt_en.md',
        "Welcome to Skyland — you're talking to our AI assistant and this call is recorded. What can I help you with today?", 'en', 'EXAVITQu4vr4xnSDxMaL')),
]

agents = {a['name']: a['agent_id'] for a in api('GET', '/v1/convai/agents?page_size=50').get('agents', [])}
for name, cc in AGENTS:
    if name in agents:
        aid = agents[name]
        api('PATCH', f'/v1/convai/agents/{aid}', {'conversation_config': cc, 'platform_settings': platform_settings})
        print('uppdaterade agent', name, aid)
    else:
        aid = api('POST', '/v1/convai/agents/create', {'name': name, 'conversation_config': cc, 'platform_settings': platform_settings})['agent_id']
        print('skapade agent', name, aid)
    print('AGENT_ID', cc['agent']['language'], aid)
