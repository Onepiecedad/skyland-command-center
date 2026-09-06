import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter — 600 requests per minute per IP.
 *
 * 6 sep 2026: var 100. Dashboarden fyrar ~20 anrop vid laddning plus två
 * SSE-strömmar; med två flikar/webbläsare bakom samma IP slog SCC i taket mot
 * sig själv (429 på allt, ContextMonitor kraschade på 429-svaret → svart sida).
 * Login har sin egen, mycket snävare spärr (loginLimiter) — den rörs inte.
 */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Chat-specific limiter — 10 requests per minute per IP.
 */
export const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Chat rate limit exceeded. Please wait before sending more messages.' },
});

/**
 * Publikt webbformulär-intag (landningssidor) — 6 per minut per IP.
 * Snålt tilltaget: en människa fyller inte i fler än så, spam stoppas.
 */
export const webIntakeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 6,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'För många försök, vänta en stund.' },
});

/**
 * Admin-specific limiter — 30 requests per minute per IP.
 */
export const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Admin rate limit exceeded.' },
});

/**
 * SEC-05: inloggningsförsök — 5 per 15 minuter per IP.
 * Tidigare skyddades POST /api/v1/auth/login bara av globalLimiter, vilket
 * tillät 100 lösenordsgissningar i minuten mot ett enda operatörslösenord.
 * Lyckade inloggningar räknas inte, så normal användning märker ingenting.
 */
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'För många inloggningsförsök. Vänta 15 minuter.' },
});
