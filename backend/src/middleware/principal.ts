/**
 * Tenant-isolering, steg 1 — vem är det som anropar?
 *
 * Fram till nu har SCC haft exakt en identitet: den som har SCC_API_TOKEN
 * eller en giltig sessionscookie är operatören (Joakim) och ser allt. Det har
 * varit korrekt så länge ingen kund kunnat logga in. Innan en kundinloggning
 * byggs (Cold Experience) måste anroparen ha en identitet, och rutter som inte
 * uttryckligen är kundsäkra måste vara stängda som default.
 *
 * Datamodellen: customer_id = NULL betyder Skylands eget material (prospekt,
 * egen outreach) och är alltid enbart operatörens. En kund ser bara rader som
 * uttryckligen bär hens customer_id — .eq() utesluter NULL av sig själv, så
 * default är att inte se något.
 */

import { Request, Response, NextFunction } from 'express';

export type Principal =
    | { kind: 'operator'; source: 'token' | 'session' }
    | { kind: 'customer'; customerId: string };

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            principal?: Principal;
        }
    }
}

export function isOperator(p: Principal | undefined): boolean {
    return p?.kind === 'operator';
}

/**
 * Stänger en rutt för allt utom operatören. Ligger direkt efter authMiddleware
 * på /api/v1 och gäller därmed allt som inte medvetet monterats före den.
 *
 * När en kundvy byggs: montera den routern MELLAN authMiddleware och den här
 * grinden i server.ts, och läs data via tenantScope — aldrig genom att ta bort
 * grinden här.
 */
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
    if (isOperator(req.principal)) {
        next();
        return;
    }
    res.status(403).json({
        error: 'Operatörsbehörighet krävs',
        code: 'operator_only',
    });
}
