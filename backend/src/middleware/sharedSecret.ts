/**
 * SEC-02/03 — Delad hemlighet för externa anropare.
 *
 * Fyra endpoint-grupper monteras FÖRE den globala authMiddleware eftersom de
 * anropas av externa system (ElevenLabs, n8n, Cal.com) som inte kan hålla en
 * sessionscookie. Historiskt saknade `/voice/*` och `/webhooks/openwork` auth
 * helt — `POST /voice/tools` når `ask_alex` → gateway `/hooks/agent` med full
 * skill-access och gör direkta Supabase-frågor. Den var öppen mot internet.
 *
 * Den här fabriken ger samma kontroll som de befintliga webhook-vakterna
 * (leads/email/ig-dm/calcom) men på ett ställe, med timing-säker jämförelse.
 *
 * Escape hatch: sätt <ENV_NAME>_ENFORCED=false för att tillfälligt släppa
 * igenom med en WARN-logg per anrop. Avsett för fönstret mellan deploy och att
 * den externa leverantören hunnit konfigureras om — aldrig som permanent läge.
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { logger } from '../services/logger';

/** Konstanttidsjämförelse som inte läcker längden på hemligheten. */
function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        // Jämför ändå mot sig själv så tidsprofilen blir densamma.
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

export interface SharedSecretOptions {
    /** Env-variabeln som håller hemligheten, t.ex. 'VOICE_WEBHOOK_TOKEN'. */
    envName: string;
    /** Namn i loggar och felmeddelanden, t.ex. 'voice'. */
    label: string;
    /** Falla tillbaka på SCC_API_TOKEN när envName saknas. Default true. */
    fallbackToApiToken?: boolean;
}

export function sharedSecretAuth(opts: SharedSecretOptions) {
    const { envName, label, fallbackToApiToken = true } = opts;

    return function sharedSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
        const configured = process.env[envName];
        const expected = configured || (fallbackToApiToken ? config.SCC_API_TOKEN : '');

        // Uttrycklig, tillfällig avstängning — loggas högt varje gång så den
        // inte kan bli permanent av glömska.
        if (process.env[`${envName}_ENFORCED`] === 'false') {
            logger.warn(
                'sharedSecret',
                `[${label}] Autentisering AVSTÄNGD via ${envName}_ENFORCED=false — ` +
                'endpointen är öppen mot internet. Sätt tillbaka så snart leverantören är omkonfigurerad.',
                { path: req.path, ip: req.ip }
            );
            next();
            return;
        }

        if (!expected) {
            logger.error('sharedSecret',
                `[${label}] Ingen hemlighet konfigurerad (${envName} och SCC_API_TOKEN saknas) — nekar.`);
            res.status(503).json({ error: `${label}: autentisering ej konfigurerad` });
            return;
        }

        // Bearer-header, x-<label>-token-header eller ?token= (ElevenLabs och
        // liknande kan inte alltid sätta headers på verktygsanrop).
        const authHeader = req.headers.authorization || '';
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        const custom = req.headers[`x-${label}-token`];
        const query = typeof req.query.token === 'string' ? req.query.token : '';
        const provided = bearer || (typeof custom === 'string' ? custom : '') || query;

        if (!provided) {
            res.status(401).json({ error: `${label}: token saknas` });
            return;
        }

        if (!safeEqual(provided, expected)) {
            logger.warn('sharedSecret', `[${label}] Felaktig token`, { path: req.path, ip: req.ip });
            res.status(403).json({ error: `${label}: ogiltig token` });
            return;
        }

        next();
    };
}
