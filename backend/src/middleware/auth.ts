import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { COOKIE_NAME, parseCookie, verifySessionToken } from '../services/session';

const SCC_API_TOKEN = config.SCC_API_TOKEN;

/**
 * Authentication middleware. Accepts EITHER:
 *  1. `Authorization: Bearer <SCC_API_TOKEN>` (integrationer, lokal dev)
 *  2. `?token=<SCC_API_TOKEN>` query param (SSE/EventSource)
 *  3. httpOnly-sessioncookie från operatörslogin (SCC-36)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;

    // Try header first, then query param (for SSE/EventSource)
    let token: string | undefined;

    if (header) {
        const [scheme, headerToken] = header.split(' ');
        if (scheme !== 'Bearer' || !headerToken) {
            res.status(401).json({ error: 'Invalid Authorization format. Expected: Bearer <token>' });
            return;
        }
        token = headerToken;
    } else if (queryToken) {
        token = queryToken;
    }

    // SCC-36: sessioncookie som tredje väg (endast när ingen token skickats)
    if (!token) {
        const cookieHeader = req.headers.cookie;
        const session = cookieHeader ? parseCookie(cookieHeader, COOKIE_NAME) : null;
        if (session && verifySessionToken(session)) {
            next();
            return;
        }
        res.status(401).json({ error: 'Missing Authorization header, token query parameter or session cookie' });
        return;
    }

    if (token !== SCC_API_TOKEN) {
        res.status(403).json({ error: 'Invalid API token' });
        return;
    }

    next();
}
