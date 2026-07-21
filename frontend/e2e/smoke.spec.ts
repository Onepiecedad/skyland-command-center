import { test, expect } from '@playwright/test';

/**
 * Kritiskt användarflöde: appen laddar → (login vid behov) → CRM-vyn renderar.
 *
 * Fångar integrationsfel som enhetstesterna inte ser: att bundlen bootar,
 * att auth-gaten släpper igenom, och att CRM-panen faktiskt mountar utan att
 * krascha (vit skärm / ErrorBoundary).
 *
 * OBS om selektorer: appen saknar data-testid, så vi matchar på synlig text
 * (nav-etiketterna "CRM"/"Leads"/"Sekvenser" från App.tsx). Vill ni härda
 * testet, lägg `data-testid` på nav-knapparna och CRM-vyns rot och byt till
 * getByTestId — det gör smoken robust mot copy-ändringar.
 */

const PASSWORD = process.env.E2E_PASSWORD;

test('login → CRM-vyn renderar', async ({ page }) => {
    await page.goto('/');

    // Login-skärmen visas bara om sessionen inte redan är autentiserad. I dev
    // kan den inbakade VITE-token auto-autentisera → ingen login-skärm.
    const pwd = page.getByPlaceholder('Lösenord');
    if (await pwd.isVisible().catch(() => false)) {
        test.skip(!PASSWORD, 'Sätt E2E_PASSWORD för att köra login-flödet');
        await pwd.fill(PASSWORD!);
        await page.getByRole('button', { name: 'Logga in' }).click();
    }

    // App-skalet ska ha mountat: CRM-navet finns.
    const crmNav = page.getByText('CRM', { exact: true }).first();
    await expect(crmNav).toBeVisible({ timeout: 15_000 });

    // Fokusera sales-panen — dess undervyer (Leads/Sekvenser) blir synliga.
    await crmNav.click();
    await expect(page.getByText('Leads', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sekvenser', { exact: true }).first()).toBeVisible();
});

test('appen bootar utan konsol-krasch på startsidan', async ({ page }) => {
    const fatal: string[] = [];
    page.on('pageerror', (err) => fatal.push(err.message));

    await page.goto('/');
    // Ge SPA:t en stund att rendera och köra initiala effekter.
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(fatal, `Ohanterade fel vid boot:\n${fatal.join('\n')}`).toHaveLength(0);
});
