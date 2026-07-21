import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright-konfig för SCC-frontendens E2E-smokes.
 *
 * Förutsättningar när du kör:
 *  1. Backend måste vara igång (localhost:3001) med OPERATOR_PASSWORD satt,
 *     annars går login-flödet inte att testa.
 *  2. Frontend-dev-servern startas automatiskt av webServer nedan (npm run dev),
 *     om den inte redan är igång.
 *  3. Installera webbläsarna en gång: `npx playwright install chromium`.
 *
 * Kör: `npm run test:e2e`   (headed/debug: `npm run test:e2e:ui`)
 * Login-flödet: sätt `E2E_PASSWORD=<operatörslösenord>` i miljön.
 */

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    timeout: 30_000,
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
