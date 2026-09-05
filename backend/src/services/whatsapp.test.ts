/**
 * WhatsApp Cloud API — de rena delarna: kuverttolkning, signatur, 24h-fönstret.
 * Ingen databas, inget nät. Det som testas här är precis det som gör att ett
 * meddelande från en kund blir en rad i rätt tråd med rätt attribution.
 */

import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

vi.mock('./supabase', () => ({ supabase: { from: () => { throw new Error('inte i rena tester'); } } }));
import {
    parseWebhook, verifySignature, describeMessage, serviceWindowOpen, mapStatus, normalizeWaId,
    SERVICE_WINDOW_MS, type WaWebhookBody,
} from './whatsapp';

function envelope(value: Record<string, unknown>): WaWebhookBody {
    return {
        object: 'whatsapp_business_account',
        entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp',
            metadata: { display_phone_number: '46700000000', phone_number_id: 'PN1' }, ...value } }] }],
    };
}

describe('parseWebhook', () => {
    it('textmeddelande → ett inbound-event med namn, mid, tid och text', () => {
        const ev = parseWebhook(envelope({
            contacts: [{ profile: { name: 'Anna' }, wa_id: '4912345' }],
            messages: [{ from: '4912345', id: 'wamid.1', timestamp: '1757059200', type: 'text', text: { body: 'Hallo, ist im Januar noch frei?' } }],
        }));
        expect(ev).toHaveLength(1);
        const m = ev[0];
        expect(m.kind).toBe('message');
        if (m.kind !== 'message') return;
        expect(m.waId).toBe('4912345');
        expect(m.profileName).toBe('Anna');
        expect(m.mid).toBe('wamid.1');
        expect(m.phoneNumberId).toBe('PN1');
        expect(m.at).toBe(new Date(1757059200 * 1000).toISOString());
        expect(m.text).toBe('Hallo, ist im Januar noch frei?');
        expect(m.referral).toBeNull();
    });

    it('CTWA-annons: referral följer med (det är provisionsunderlaget)', () => {
        const ev = parseWebhook(envelope({
            messages: [{ from: '48111', id: 'wamid.2', timestamp: '1', type: 'text', text: { body: 'hej' },
                referral: { source_type: 'ad', source_id: '120200', headline: 'Northern lights', ctwa_clid: 'abc' } }],
        }));
        expect(ev[0].kind).toBe('message');
        if (ev[0].kind !== 'message') return;
        expect(ev[0].referral).toMatchObject({ source_type: 'ad', source_id: '120200', ctwa_clid: 'abc' });
    });

    it('bild utan text och röstmeddelande får läsbara rader, aldrig tomt', () => {
        const ev = parseWebhook(envelope({
            messages: [
                { from: '1', id: 'a', timestamp: '1', type: 'image', image: { id: 'MEDIA1' } },
                { from: '1', id: 'b', timestamp: '1', type: 'audio', audio: { id: 'MEDIA2', voice: true } },
                { from: '1', id: 'c', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Ja tack' } } },
            ],
        }));
        const texts = ev.map(e => e.kind === 'message' ? e.text : '');
        expect(texts).toEqual(['[bild]', '[röstmeddelande]', 'Ja tack']);
        expect(ev[0].kind === 'message' && ev[0].mediaId).toBe('MEDIA1');
    });

    it('statusar → status-event med mappad status och fel', () => {
        const ev = parseWebhook(envelope({
            statuses: [
                { id: 'wamid.out1', status: 'delivered', timestamp: '2', recipient_id: '4912345', conversation: { origin: { type: 'service' } } },
                { id: 'wamid.out2', status: 'failed', timestamp: '3', errors: [{ code: 131047, title: 'Re-engagement message' }] },
            ],
        }));
        expect(ev.map(e => e.kind)).toEqual(['status', 'status']);
        if (ev[0].kind !== 'status' || ev[1].kind !== 'status') return;
        expect(ev[0].conversationOrigin).toBe('service');
        expect(ev[1].error).toBe('131047 Re-engagement message');
    });

    it('fel object, fel field eller fel messaging_product → ingenting', () => {
        expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
        expect(parseWebhook({ object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'account_update', value: { messaging_product: 'whatsapp', messages: [{ from: '1', id: 'x', timestamp: '1', type: 'text', text: { body: 'x' } }] } }] }] })).toEqual([]);
        expect(parseWebhook(null)).toEqual([]);
    });
});

describe('verifySignature', () => {
    const secret = 'app-secret';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    it('rätt HMAC över råkroppen → true', () => {
        expect(verifySignature(body, good, secret)).toBe(true);
    });
    it('fel hemlighet, fel kropp, saknad header → false', () => {
        expect(verifySignature(body, good, 'annan')).toBe(false);
        expect(verifySignature(Buffer.from('{"hello":"world "}'), good, secret)).toBe(false);
        expect(verifySignature(body, undefined, secret)).toBe(false);
        expect(verifySignature(undefined, good, secret)).toBe(false);
    });
    it('fel längd kraschar inte timingSafeEqual', () => {
        expect(verifySignature(body, 'sha256=abc', secret)).toBe(false);
    });
});

describe('serviceWindowOpen — 24 timmar från kundens senaste meddelande', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    it('23 h gammalt → öppet; 25 h → stängt; saknas → stängt', () => {
        expect(serviceWindowOpen(new Date(now.getTime() - 23 * 3600e3).toISOString(), now)).toBe(true);
        expect(serviceWindowOpen(new Date(now.getTime() - 25 * 3600e3).toISOString(), now)).toBe(false);
        expect(serviceWindowOpen(null, now)).toBe(false);
    });
    it('exakt 24 h är stängt (gränsen är strikt)', () => {
        expect(serviceWindowOpen(new Date(now.getTime() - SERVICE_WINDOW_MS).toISOString(), now)).toBe(false);
    });
});

describe('småfunktioner', () => {
    it('mapStatus: read räknas som delivered, okänt → null', () => {
        expect(mapStatus('sent')).toBe('sent');
        expect(mapStatus('read')).toBe('delivered');
        expect(mapStatus('failed')).toBe('failed');
        expect(mapStatus('warning')).toBeNull();
    });
    it('normalizeWaId tar bort plus, mellanslag och bindestreck', () => {
        expect(normalizeWaId('+46 70-123 45 67')).toBe('46701234567');
        expect(normalizeWaId(null)).toBe('');
    });
    it('describeMessage: dokument med filnamn, plats med namn', () => {
        expect(describeMessage({ from: '1', id: 'x', timestamp: '1', type: 'document', document: { id: 'd', filename: 'offert.pdf' } }).text).toBe('[dokument: offert.pdf]');
        expect(describeMessage({ from: '1', id: 'x', timestamp: '1', type: 'location', location: { latitude: 1, longitude: 2, name: 'Kiruna' } }).text).toBe('[plats] Kiruna');
    });
});
