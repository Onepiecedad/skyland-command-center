/** SCC-48 — sajt-webhookarnas rena logik (validering, poäng, språk, röstnormalisering). Inga nätanrop. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/supabase', () => ({ supabase: { from: () => ({}) }, websiteSupabase: null }));
vi.mock('../config', () => ({ config: { SCC_API_TOKEN: 't', OPENAI_API_KEY: undefined } }));
vi.mock('../services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./leads', () => ({ ingestLead: vi.fn() }));
vi.mock('../services/siteRag', () => ({ ragQuery: vi.fn() }));

import { sanitizeEvents, scoreLead, detectLanguage, normalizeVoicePayload } from './siteWebhooks';

const SID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('sanitizeEvents', () => {
    it('kräver v4-uuid och kastar okända typer och fält', () => {
        expect(sanitizeEvents({ session_uuid: 'nope', events: [{ type: 'page_view' }] })).toBeNull();
        const rows = sanitizeEvents({ session_uuid: SID.toUpperCase(), events: [
            { type: 'page_view', data: { module: 'void', ip: '1.2.3.4', lang: 'sv' } },
            { type: 'hack', data: {} },
            { type: 'roi_input', data: { hours: 999, rate: -5, seconds: 12.6 } },
        ] });
        expect(rows).toHaveLength(2);
        expect(rows![0]).toEqual({ session_uuid: SID, type: 'page_view', data: { module: 'void', lang: 'sv' } });
        expect(rows![1].data).toEqual({ hours: 200, rate: 0, seconds: 13 });
    });
    it('cappar batchen till 25', () => {
        const events = Array.from({ length: 40 }, () => ({ type: 'page_view', data: {} }));
        expect(sanitizeEvents({ session_uuid: SID, events })).toHaveLength(25);
    });
});

describe('scoreLead', () => {
    it('räknar som n8n-flödet och cappar på 100', () => {
        expect(scoreLead({ company: '', website: '', phone: '', message: 'kort text' })).toBe(0);
        const msg = Array(30).fill('ord').join(' ') + ' crm automation voice agent chatbot hemsida integration n8n supabase';
        expect(scoreLead({ company: 'AB', website: 'https://x.se', phone: '0701234567', message: msg })).toBe(85);
        const msg2 = msg + ' ' + msg + ' crm';
        expect(scoreLead({ company: 'AB', website: 'https://x.se', phone: '0701234567', message: msg2 })).toBeLessThanOrEqual(100);
    });
});

describe('detectLanguage', () => {
    it('engelska utan åäö → ENGLISH, annars SWEDISH', () => {
        expect(detectLanguage('We need help with our booking system')).toBe('ENGLISH');
        expect(detectLanguage('Vi behöver hjälp med bokningar')).toBe('SWEDISH');
        expect(detectLanguage('The salong behöver fler kunder')).toBe('SWEDISH');
    });
});

describe('normalizeVoicePayload', () => {
    it('avvisar utan session/conversation', () => {
        const r = normalizeVoicePayload({ transcript: 'hej' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toContain('session_uuid required');
    });
    it('plockar namn, företag, e-post och mötesönskan ur transkriptet', () => {
        const transcript = [
            'agent: Hej! Vad heter du?', 'user: Anna Berg.',
            'agent: Och vad heter företaget?', 'user: Bergs Salong',
            'agent: Vad tar mest tid idag?', 'user: eh bokningar, fakturor och uppföljning',
            'user: min mail är anna@bergs.se, boka in ett möte gärna',
        ].join('\n');
        const r = normalizeVoicePayload({ metadata: { session_uuid: SID }, conversationId: 'conv_1', transcript, durationSeconds: 90 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.external_call_id).toBe('conv_1');
        expect(r.duration_seconds).toBe(90);
        expect(r.extracted_data.person_name).toBe('Anna Berg');
        expect(r.extracted_data.company_name).toBe('Bergs Salong');
        expect(r.extracted_data.email).toBe('anna@bergs.se');
        expect(r.extracted_data.pain_points).toEqual(['bokningar', 'fakturor', 'uppföljning']);
        expect(r.extracted_data.meeting_requested).toBe(true);
        expect(r.summary).toContain('Hej! Vad heter du?');
    });
});
