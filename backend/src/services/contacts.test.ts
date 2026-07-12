import { describe, it, expect } from 'vitest';
import {
    deriveContactFromLead,
    mergeContactFields,
    type LeadPayload,
    type ContactRow,
} from './contacts';

// These tests cover the PURE mapping/merge logic that SCC-23 puts in the live
// lead-intake path. No database is touched. Written before routes/leads.ts is
// changed, per the F1 risk note.

describe('deriveContactFromLead', () => {
    it('maps a void_form lead to a contact row', () => {
        const lead: LeadPayload = {
            source: 'void_form',
            name: 'Anna Berg',
            email: 'anna@example.se',
            phone: '070-1234567',
            company: 'Berg AB',
            website: 'berg.se',
            message: 'Vill veta mer',
            score: 82,
            session_uuid: 'sess-1',
        };
        const c = deriveContactFromLead(lead, 'dk-1');
        expect(c.name).toBe('Anna Berg');
        expect(c.email).toBe('anna@example.se');
        expect(c.status).toBe('new');
        expect(c.source).toBe('void_form');
        expect(c.dedupe_key).toBe('dk-1');
        expect(c.custom).toMatchObject({ message: 'Vill veta mer', score: 82, session_uuid: 'sess-1' });
    });

    it('maps a voice_call lead with summary and extracted data', () => {
        const lead: LeadPayload = {
            source: 'voice_call',
            name: 'Erik Ek',
            summary: 'Ringde om offert',
            extracted: { intent: 'quote', budget: '10k' },
        };
        const c = deriveContactFromLead(lead, 'dk-2');
        expect(c.source).toBe('voice_call');
        expect(c.custom.summary).toBe('Ringde om offert');
        expect(c.custom.extracted).toEqual({ intent: 'quote', budget: '10k' });
    });

    it('collapses empty / whitespace strings to null', () => {
        const lead: LeadPayload = { source: 'void_form', name: '   ', email: '', company: null };
        const c = deriveContactFromLead(lead, 'dk-3');
        expect(c.name).toBeNull();
        expect(c.email).toBeNull();
        expect(c.company).toBeNull();
    });

    it('omits score from custom when not a number', () => {
        const lead: LeadPayload = { source: 'void_form', score: null };
        const c = deriveContactFromLead(lead, 'dk-4');
        expect('score' in c.custom).toBe(false);
    });
});

describe('mergeContactFields', () => {
    const incomingSparse: ContactRow = {
        name: null,
        email: 'new@example.se',
        phone: null,
        company: null,
        website: null,
        status: 'new',
        source: 'voice_call',
        dedupe_key: 'dk-1',
        custom: { summary: 'ny sammanfattning' },
    };

    it('does not overwrite existing fields with null', () => {
        const existing: Partial<ContactRow> = {
            name: 'Anna Berg',
            email: 'anna@example.se',
            phone: '070-1234567',
            status: 'qualified',
            source: 'void_form',
            custom: { message: 'gammalt' },
        };
        const merged = mergeContactFields(existing, incomingSparse);
        expect(merged.name).toBe('Anna Berg');           // kept
        expect(merged.phone).toBe('070-1234567');        // kept
        expect(merged.email).toBe('new@example.se');     // updated (incoming non-null)
    });

    it('never downgrades an advanced status back to new', () => {
        const existing: Partial<ContactRow> = { status: 'won' };
        const merged = mergeContactFields(existing, incomingSparse);
        expect(merged.status).toBe('won');
    });

    it('takes the incoming status when existing is still new', () => {
        const existing: Partial<ContactRow> = { status: 'new' };
        const incomingWorking: ContactRow = { ...incomingSparse, status: 'working' };
        const merged = mergeContactFields(existing, incomingWorking);
        expect(merged.status).toBe('working');
    });

    it('shallow-merges custom, keeping old keys and adding new', () => {
        const existing: Partial<ContactRow> = { custom: { message: 'gammalt', score: 50 } };
        const merged = mergeContactFields(existing, incomingSparse);
        expect(merged.custom).toEqual({ message: 'gammalt', score: 50, summary: 'ny sammanfattning' });
    });

    it('keeps the original source', () => {
        const existing: Partial<ContactRow> = { source: 'void_form' };
        const merged = mergeContactFields(existing, incomingSparse);
        expect(merged.source).toBe('void_form');
    });
});
