/**
 * SCC-36 — Sessionshantering för operatörslogin.
 * HMAC-signerade tokens (Nodes inbyggda crypto — inga dependencies).
 * Token: "<exp>.<hmac>" där hmac = HMAC-SHA256(secret, "scc-session:<exp>").
 */

import crypto from 'crypto';
import { config } from '../config';

export const COOKIE_NAME = 'scc_session';
export const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagar

function sign(exp: number, secret: string): string {
    return crypto.createHmac('sha256', secret).update(`scc-session:${exp}`).digest('hex');
}

/** Skapar en signerad sessionstoken, eller null om auth inte är konfigurerat. */
export function createSessionToken(now: number = Date.now()): string | null {
    const secret = config.AUTH_SESSION_SECRET;
    if (!secret) return null;
    const exp = now + TTL_MS;
    return `${exp}.${sign(exp, secret)}`;
}

/** Verifierar signatur + utgångstid. Timing-safe jämförelse. */
export function verifySessionToken(token: string, now: number = Date.now()): boolean {
    const secret = config.AUTH_SESSION_SECRET;
    if (!secret) return false;

    const dotIndex = token.indexOf('.');
    if (dotIndex <= 0) return false;

    const expStr = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || sig.length === 0 || now > exp) return false;

    const expected = sign(exp, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** Plockar ut en namngiven cookie ur en Cookie-header. */
export function parseCookie(header: string, name: string): string | null {
    for (const part of header.split(';')) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        if (trimmed.slice(0, eq) === name) {
            return decodeURIComponent(trimmed.slice(eq + 1));
        }
    }
    return null;
}

/** Timing-safe strängjämförelse (för lösenordskontroll). */
export function timingSafeEqualStr(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) {
        // Jämför ändå mot dummy för att inte läcka längd via timing
        crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
        return false;
    }
    return crypto.timingSafeEqual(ab, bb);
}
