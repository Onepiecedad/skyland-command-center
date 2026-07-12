# Hemsidans telemetri-kontrakt (skyland-ai-os → events-tabellen)

> Vad SCC:s Hemsida-dashboard förväntar sig att hemsidan skickar.
> Rotorsak till "funnel visar 0": hemsidan avfyrar aldrig de event-typer som
> funnel-stegen mäter. Denna fil är specen som netlify-sidan måste följa.
> Uppdaterad: 2026-07-11

---

## Symptomet

På Hemsida-dashboarden visade KPI-korten Leads 6 och Röstsamtal 5, men funneln
visade Engagemang 0, Lead-händelse 0, Boknings-klick 0. Görans session hade bara
två events: `page_view` (core) och `lang` (EN).

## Varför

KPI-korten och funneln läser från **två olika källor**:

| Mätvärde | Källa |
|---|---|
| KPI: Leads | `prospects`-tabellen (server-side, n8n skriver) |
| KPI: Röstsamtal | `voice_calls`-tabellen (server-side) |
| Funnel: Engagemang / Lead-händelse / Boknings-klick | `events`-tabellen (client-side telemetri från hemsidan) |

Funnel-stegen tickar alltså BARA om webbläsaren skickar rätt event-typer till
`events`-tabellen. Hemsidan gör inte det för röstsamtal och bokningsklick, så
funneln står på noll trots att samtal och bokningar sker.

> **SCC-sidan är redan härdad (2026-07-11):** `website.ts` folder nu in
> prospect- och voice_call-sessioner i `engaged`/`leads` som fallback, så
> dashboarden inte längre visar falska nollor. Men **den enda riktiga fixen är
> att hemsidan skickar rätt events** — annars förlorar du steg-för-steg-signalen
> (t.ex. hur många som startade ett röstsamtal men inte slutförde).

---

## Event-typer SCC räknar på (måste skickas av hemsidan)

Insert i `events`-tabellen (website Supabase). Rad-form:
`{ session_uuid, type, data (jsonb), created_at }`.

### Engagemang (någon av dessa → sessionen räknas som "engaged")
| type | När den ska skickas | data |
|---|---|---|
| `video_play` | Besökaren startar introvideon | `{}` |
| `starter_click` | Klick på en "starter"-knapp | `{}` |
| `form_start` | Besökaren börjar fylla i kontaktformuläret | `{}` |
| `voice_start` | **Röstsamtal startar** (agenten kopplas upp) | `{ session_uuid }` |
| `roi_input` | Besökaren använder ROI-kalkylatorn | `{ hours, rate }` |

### Lead-händelse (någon av dessa → sessionen räknas som "lead")
| type | När | data |
|---|---|---|
| `form_submit` | Kontaktformuläret skickas | `{}` |
| `voice_end` | **Röstsamtal avslutas** | `{ seconds }` (fältet MÅSTE heta `seconds` — n8n:s Validate & Sanitize whitelistar bara `d.seconds`, cappat 0–86400) |

### Boknings-klick
| type | När | data |
|---|---|---|
| `cta_book_click` | Klick på boknings-CTA (Cal.com/Calendly) | `{}` |

### Övriga (redan i bruk)
`page_view`, `lang` (`{ lang: 'EN' }`), `video_complete`, `voice_error`,
`form_error`.

> Not: frontend-etiketten för `cta_book_click` säger "Calendly-klick" men
> systemet bokar numera via Cal.com. Justera etiketten i
> `frontend/src/pages/WebsiteView.tsx` (EVENT_LABELS) om det förvirrar.

---

## Den kritiska luckan att stänga på hemsidan

Röstsamtalsflödet på hemsidan MÅSTE skicka minst:

1. **`voice_start`** när ElevenLabs-widgeten kopplar upp — med samma
   `session_uuid` som resten av sessionen.
2. **`voice_end`** när samtalet avslutas — med `session_uuid` och
   `duration_seconds`.
3. **`cta_book_click`** om/när besökaren klickar boknings-CTA:t.

Utan (1) och (2) kan funneln aldrig visa "hur många startade vs slutförde ett
röstsamtal" — SCC:s fallback räknar bara slutförda (de som blev prospect/call),
inte avhoppen.

## Verifiering efter fix

1. Kör ett röstsamtal på hemsidan.
2. Kontrollera `events`-tabellen: `voice_start` och `voice_end` ska finnas med
   rätt `session_uuid`.
3. Ladda om Hemsida-dashboarden: Engagemang och Lead-händelse ska öka.
4. `session-init` / `voice-call-ended` n8n-workflows ska fortsatt vara gröna.
