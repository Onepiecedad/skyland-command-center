import { test, expect, type Page } from '@playwright/test';

/**
 * Kritiskt användarflöde: appen laddar → (login vid behov) → CRM-vyn renderar.
 *
 * Fångar integrationsfel som enhetstesterna inte ser: att bundlen bootar, att
 * auth-gaten släpper igenom, och att CRM-panen faktiskt mountar utan att krascha.
 *
 * Navigering: appen använder en FocusNavigator där bara EN panel är i fokus åt
 * gången (default 'alex'); grannpanelerna är renderade men aria-hidden. CRM bor
 * i sales-panelen, så vi fokuserar den via appens EGET event `scc:focus-pane`
 * (samma mekanism som Alex navigate_ui använder) innan vi asserterar synlighet.
 */

const PASSWORD = process.env.E2E_PASSWORD;

/** Loggar in om login-skärmen visas (i dev auto-autentiserar VITE-token → ingen skärm). */
async function ensureLoggedIn(page: Page): Promise<void> {
    const pwd = page.getByPlaceholder('Lösenord');
    if (await pwd.isVisible().catch(() => false)) {
        test.skip(!PASSWORD, 'Sätt E2E_PASSWORD för att köra login-flödet');
        await pwd.fill(PASSWORD!);
        await page.getByRole('button', { name: 'Logga in' }).click();
        await expect(pwd, 'login-skärmen ska försvinna efter inloggning').toBeHidden({ timeout: 15_000 });
    }
}

test('login → CRM-vyn renderar', async ({ page }) => {
    await page.goto('/');
    await ensureLoggedIn(page);

    // CRM bor i sales-panelen (default-fokus är 'alex', så den är dold granne).
    // getByText matchar seg-btn-knappens textnod (getByRole missar den pga ikonen
    // i knappens tillgängliga namn).
    const crm = page.getByText('CRM', { exact: true }).first();

    // Vänta tills app-skalet mountat (knappen finns i DOM = FocusNavigator har
    // hunnit registrera sin scc:focus-pane-lyssnare) innan vi skickar eventet.
    await expect(crm, 'CRM-navet ska ha mountat').toBeAttached({ timeout: 15_000 });

    // Fokusera sales via appens eget event. Omdispatcha i en poll så vi inte
    // tappar eventet på en render-race; focusPane är idempotent (no-op om redan
    // fokuserad), så upprepning är ofarlig.
    await expect(async () => {
        await page.evaluate(() =>
            window.dispatchEvent(new CustomEvent('scc:focus-pane', { detail: { pane: 'sales' } }))
        );
        await expect(crm).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    // Sales-panelens undernav ska nu vara synlig.
    await expect(page.getByText('Leads', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sekvenser', { exact: true }).first()).toBeVisible();
});

test('appen bootar utan ohanterat fel', async ({ page }) => {
    const fatal: string[] = [];
    page.on('pageerror', (err) => fatal.push(err.message));

    // OBS: inte networkidle — appen håller SSE/WebSocket öppna (realtidsflödet),
    // så nätverket blir aldrig "idle". Vänta på DOM + en stund för initiala effekter.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page);
    await page.waitForTimeout(3_000);

    expect(fatal, `Ohanterade fel vid boot:\n${fatal.join('\n')}`).toHaveLength(0);
});
