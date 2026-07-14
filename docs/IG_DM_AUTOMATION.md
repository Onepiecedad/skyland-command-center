# Instagram DM/kommentar-automation (Meta + n8n)

> Byggd 2026-07-14. Autosvar på nyckelord i DM OCH kommentarer, på @skylandaisystem.
> Detta är samma MEXPAND-motor Skyland säljer — körande på egna kontot först (bästa demon).

## Arkitektur

Instagram (DM eller kommentar med nyckelord) → Meta webhook → **n8n Cloud**
(`onepiecedad.app.n8n.cloud/webhook/ig-dm`) → nyckelordskoll → autosvar via Instagram
Graph API. Statiska, förhandsgodkända svar (ingen AI i utskicket → policy-säkert).

- **n8n-workflow:** `ig-dm-autosvar` (id `nN8u7PE5yP1sY88t`), aktiv/published.
- **Noder:** Webhook Verify (GET → challenge) · Webhook DM (POST) → Hantera DM (nyckelord,
  Code) → Skicka autosvar (HTTP POST graph.instagram.com/v23.0/me/messages).
- **Två fall hanteras:** DM (`entry[].messaging[].message.text`, recipient `{id}`) och
  kommentar (`entry[].changes[].value`, field `comments`, recipient `{comment_id}` =
  privat DM-svar till den som kommenterade, "comment-to-DM").

## Meta-app

- Namn: **Skyland DM**, App ID `1515220220291042`. Ägare: Joakim (personligt dev-konto).
- Use case: "Manage messaging & content on Instagram". Publicerad/**Live** (krävs för
  meddelande-webhooks — annars kommer bara verifierings-pingen fram).
- Kopplat IG-konto: **@skylandaisystem** (IG-ID `17841413337571338`) som Instagram Tester.
- Behörigheter: instagram_business_basic, _manage_comments, _manage_messages, _content_publish.
- **Webhook:** Callback `https://onepiecedad.app.n8n.cloud/webhook/ig-dm`, verify token
  `skyland-ig-verify-2026`, prenumeration = messages + comments, subscription-toggle On.
- **Dev-läge räcker för egna kontot.** App Review krävs först i F4 (kundernas konton).

## Nyckelord → svar (per karusell)

- `stol` → "missade DM"-vinkeln (karusell 1)
- `vecka` → "tomma vardagar"-vinkeln (karusell 2)
Svaren ligger i Code-noden `Hantera DM (nyckelord)`, skrivna i Joakims röstprofil
(`docs/VOICE_JOAKIM.md`) och namnger draget högt ("det här är ett autosvar").
Lägg till fler nyckelord där när nya karuseller släpps.

## Drift / att veta

- **Token dör efter 60 dagar** (~2026-09-12). Long-lived IG-token ligger hårdkodad i
  Code-noden. Förnya: generera ny i Meta-appen (API setup → Generate token) → klistra in
  i noden. TODO: bygg auto-refresh-nod.
- Token är en hemlighet — finns bara i n8n-noden, inte i repot.
- **Ännu INTE kopplat till SCC-CRM.** Nästa steg: lägg en HTTP-nod efter "Skicka autosvar"
  som POST:ar till `https://scc.skylandai.se/api/v1/leads/intake` (källa `ig_dm`) så varje
  "stol"/"vecka" blir en contact i unified inbox + Alex-flagga. Kräver att intake-schemat
  får en `ig_dm`-källa (litet backend-jobb).
- Manuell personlig uppföljning måste följa autosvaret inom timmar — systemet öppnar dörren,
  Joakim stänger affären.
