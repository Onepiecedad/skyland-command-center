/**
 * SCC-36 — Operatörslogin.
 * POST /login  → verifierar lösenord (timing-safe) → httpOnly-sessioncookie.
 * GET  /me     → är anropet autentiserat (cookie ELLER bearer)?
 * POST /logout → nollar cookien.
 *
 * Mountas EFTER globalLimiter men FÖRE authMiddleware (login måste vara öppen).
 * Alla försök loggas som activities.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { supabase } from '../services/supabase';
import {
    COOKIE_NAME,
    TTL_MS,
    createSessionToken,
    verifySessionToken,
    parseCookie,
    timingSafeEqualStr,
} from '../services/session';

const router = Router();

function cookieFlags(): string {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `HttpOnly; Path=/; SameSite=Lax${secure}`;
}

router.post('/login', async (req: Request, res: Response) => {
    if (!config.OPERATOR_PASSWORD || !config.AUTH_SESSION_SECRET) {
        return res.status(501).json({
            error: 'Login är inte konfigurerat (OPERATOR_PASSWORD + AUTH_SESSION_SECRET krävs i env)',
        });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ok = password.length > 0 && timingSafeEqualStr(password, config.OPERATOR_PASSWORD);

    try {
        await supabase.from('activities').insert({
            customer_id: null,
            agent: 'system:auth',
            event_type: 'auth',
            action: ok ? 'login_success' : 'login_failed',
            severity: ok ? 'info' : 'warn',
            details: { ip: req.ip ?? null },
        });
    } catch {
        // logg-miss får aldrig blockera login-svaret
    }

    if (!ok) return res.status(401).json({ error: 'Fel lösenord' });

    const token = createSessionToken();
    if (!token) return res.status(500).json({ error: 'Kunde inte skapa session' });

    res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${token}; ${cookieFlags()}; Max-Age=${Math.floor(TTL_MS / 1000)}`
    );
    return res.json({ authenticated: true });
});

router.get('/me', (req: Request, res: Response) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ') && header.slice(7) === config.SCC_API_TOKEN) {
        return res.json({ authenticated: true, via: 'token' });
    }
    const cookieHeader = req.headers.cookie;
    const session = cookieHeader ? parseCookie(cookieHeader, COOKIE_NAME) : null;
    if (session && verifySessionToken(session)) {
        return res.json({ authenticated: true, via: 'session' });
    }
    return res.status(401).json({ authenticated: false });
});

router.post('/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieFlags()}; Max-Age=0`);
    return res.json({ authenticated: false });
});

export default router;
