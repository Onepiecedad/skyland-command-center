/**
 * Robotfilter för webbspårningen (alla tenants).
 *
 * Sökmotorer, SEO-verktyg, prestandamätare och skript kör sajternas JS och
 * skickade förr sessioner och händelser precis som en människa. Thomas panel
 * räknade 106 besök medan SCC visade 125 — skillnaden var Googlebot & co.
 *
 * Regeln: en riktig webbläsare skickar alltid en user-agent som börjar med
 * "Mozilla/". Saknas den, eller innehåller den något av mönstren nedan, är det
 * en robot. Mönstren är hämtade ur verklig trafik i `sessions` (16 sep 2026).
 * Samma lista finns i SQL i database/migrations/scc_robotfilter.sql — ändra båda.
 */
export const ROBOT_MONSTER = new RegExp(
    [
        '(?<!cu)bot\\b', 'bot/',                     // Googlebot, bingbot, AhrefsBot… men inte Cubot-telefoner
        'crawl', 'spider', 'slurp', 'scrap',
        'headless', 'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptime', 'statuscake', 'site24x7',
        'moto g power \\(2022\\)',                   // PageSpeed Insights mobilemulering
        'edge/12\\.246',                             // förfalskad UA som skannrar använder
        'bingpreview', 'facebookexternalhit', 'meta-external', 'meta-webindexer',
        'google-inspectiontool', 'googleother', 'google-read-aloud', 'adsbot', 'mediapartners',
        'dataprovider', 'bitsight', 'ahrefs', 'semrush', 'mj12', 'petalbot', 'yandex', 'baidu', 'sogou',
        'bytespider', 'gptbot', 'claudebot', 'perplexity', 'ccbot', 'applebot', 'duckduck',
        'linkedinbot', 'twitterbot', 'slackbot', 'discordbot', 'telegrambot', 'whatsapp',
        'curl/', 'wget', 'python', 'axios', 'node-fetch', 'undici', 'go-http', 'java/', 'okhttp', 'httpclient', 'postman',
    ].join('|'),
    'i',
);

export function arRobot(userAgent: unknown): boolean {
    const ua = typeof userAgent === 'string' ? userAgent.trim() : '';
    if (!ua) return true;
    if (!/^mozilla\//i.test(ua)) return true;
    return ROBOT_MONSTER.test(ua);
}
