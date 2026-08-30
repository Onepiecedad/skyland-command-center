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

- `stol` → "missade DM"-vinkeln. **Meddelandet uppdaterat 2026-07-25** till
  annonsbudget-modellen (studion lägger liten annonsbudget, Joakim kör annonser + sköter
  bokning/admin, 10% per bokning, inget fast/förskott).
- ~~`vecka`~~ → **BORTTAGET 2026-07-19** (exakt-match-fixen — nyckelordet krockade med
  prospekterings-trådar där folk skrev "vecka" i vanliga svar). Bara `stol` är live nu.

Svaren ligger i Code-noden `Hantera DM (nyckelord)`, skrivna i Joakims röstprofil
(`docs/VOICE_JOAKIM.md`) och namnger draget högt ("det här är ett autosvar"). Matchningen är
EXAKT (`norm===kw`), inte substring. Lägg till fler nyckelord där när nya karuseller släpps —
och håll svaren i linje med annonsbudget-modellen.

## Drift / att veta

- **Token dör efter 60 dagar** (~2026-09-12). Long-lived IG-token ligger hårdkodad i
  Code-noden. Förnya: generera ny i Meta-appen (API setup → Generate token) → klistra in
  i noden. TODO: bygg auto-refresh-nod.
- Token är en hemlighet — finns bara i n8n-noden, inte i repot.
- **Kopplat till SCC-CRM (klart).** Efter autosvaret går en gren
  `SCC-extrakt → Hämta IG-username → Bygg SCC-payload → Logga till SCC` som POST:ar till
  `https://scc.skylandai.se/api/v1/webhooks/ig-dm`. Varje träff loggas alltså in i CRM:et
  (samma webhook som IG-DM-autologgen, härdad 2026-07-19: matchar på numeriskt IG-id först,
  self-heal, `ig_dm_unmatched`-aktivitet vid no-match).
- Manuell personlig uppföljning måste följa autosvaret inom timmar — systemet öppnar dörren,
  Joakim stänger affären.
