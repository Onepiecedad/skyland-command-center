# 💡 Idéer - Projektideer Management

En ny avdelning i SCC för att samla och hantera alla projektidéer.

## Funktioner

- **Skapa idéer** - Titel, beskrivning, kategori, prioritering, taggar
- **Status-tracking** - Ny, pågående, planerad, klar, arkiverad
- **Filter & sök** - Filtrera på status, sök i titel/beskrivning/taggar
- **Taggar** - Organisera idéer med taggar
- **React Query** - Automatisk caching och realtids-uppdateringar

## API Endpoints

- `GET /api/v1/ideas` - Lista alla idéer
- `POST /api/v1/ideas` - Skapa ny idé
- `PATCH /api/v1/ideas/:id` - Uppdatera idé
- `DELETE /api/v1/ideas/:id` - Ta bort idé
- `GET /api/v1/ideas/stats/overview` - Statistik

## Frontend

- URL: `/ideas`
- Komponent: `IdeasView.tsx`
- Ikon: 💡 (Lightbulb)

## Förinstallerade idéer

1. **Skapa AI-influencer kanal** - TikTok/Instagram om vibe-kodning och AI-agenter
2. **Content research dashboard** - Bevaka 10-15 konton för inspiration
3. **Godkännande-workflow** - Content-förslag → godkännande → publicering
4. **AI-avatar skapelse** - Generera konsekvent avatar för video

## Användning

1. Klicka på 💡 Idéer i sidomenyn
2. Klicka "Ny idé" för att lägga till
3. Fyll i titel, beskrivning, välj kategori och prioritet
4. Lägg till taggar (kommaseparerade)
5. Klicka på status-badge för att ändra status
6. Använd sökrutan för att hitta specifika idéer
