# E2E-smokes (Playwright)

Kritiskt användarflöde: appen laddar → login vid behov → CRM-vyn renderar. Fångar
integrationsfel som enhetstesterna inte ser (vit skärm, trasig auth-gate, boot-krasch).

## Engångsuppsättning
```bash
cd frontend
npm install --legacy-peer-deps      # om inte redan gjort
npx playwright install chromium     # laddar ner webbläsaren
```

## Förutsättningar för en körning
- **Backend igång** på `localhost:3001` med `OPERATOR_PASSWORD` satt (annars går login inte att testa).
- Frontend-dev-servern startas automatiskt av `playwright.config.ts` (`npm run dev`) om den inte redan kör.

## Kör
```bash
npm run test:e2e                    # headless
npm run test:e2e:ui                 # interaktivt (debug)
```

Testa login-flödet explicit:
```bash
E2E_PASSWORD='<operatörslösenord>' npm run test:e2e
```
Utan `E2E_PASSWORD` hoppas login-steget över om login-skärmen dyker upp (i dev
auto-autentiserar ofta den inbakade VITE-token → ingen login-skärm).

## Härda testet
Appen saknar `data-testid`, så smoken matchar på synlig text (nav-etiketterna).
Lägg `data-testid` på nav-knapparna och CRM-vyns rot och byt till `getByTestId`
för selektorer som är robusta mot copy-ändringar.
