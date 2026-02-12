import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const SCC_API_TOKEN = config.SCC_API_TOKEN;

/**
 * Bearer token authentication middleware.
 * Validates `Authorization: Bearer <token>` against SCC_API_TOKEN.
 * Also accepts `?token=<token>` query param for EventSource/SSE connections.
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

    if (!token) {
        res.status(401).json({ error: 'Missing Authorization header or token query parameter' });
        return;
    }

    if (token !== SCC_API_TOKEN) {
        res.status(403).json({ error: 'Invalid API token' });
        return;
    }

    next();
}
