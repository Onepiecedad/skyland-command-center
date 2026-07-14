# Skyland karusellgenerator

Instagram-karuseller (1080×1350 @2x) i Skylands designsystem — copy in som JSON,
färdiga PNG:er ut. Designen matchar original-karusellen (mörk botten, SKYLAND-header,
orange accent, progressbar).

## Kör

```bash
cd tools/carousel
node build.mjs slides.example.json     # → out/slide-01.png … slide-06.png
```

Kräver Google Chrome (renderas headless). Node via nvm: `nvm use 22`.

## Ny karusell

1. Kopiera `slides.example.json` → `min-karusell.json`
2. Skriv copyn (be gärna Alex om utkast — röstprofilen ligger i systemprompten)
3. `node build.mjs min-karusell.json`
4. Posta via IG-appen eller schemalägg i Meta Business Suite

## Block-typer

| kind | Fält | Beskrivning |
|------|------|-------------|
| `kicker` | text, color (orange/gray) | Mono-etikett överst |
| `headline` | text, size (l/m/s) | Stor rubrik |
| `sub` | text, size (l/s) | Grå underrubrik |
| `note` | text, italic, color | Fet brödtext |
| `calc` | text | Mono-räknerad (versaler) |
| `bignumber` | text, suffix | Jättesiffra i orange |
| `card` | header, text | Meddelandekort |
| `pills` | items[], active | Pillerrad (aktiv = orange) |
| `quote` | lead, text | Citat med orange kantlinje |
| `cta` | text | Orange CTA-knapp |
| `footer` | text | Mono-sidfot |
| `spacer` | px | Vertikalt mellanrum |

Markup i alla texter: `~orange~` · `*fet*` · `_kursiv_` · `\n` radbrytning.

## Postning

Manuellt tills Meta-appen är verifierad (samma verifiering som Lead Ads-spåret).
Därefter: Graph API `instagram_content_publish` via n8n/SCC med approve-flöde.
