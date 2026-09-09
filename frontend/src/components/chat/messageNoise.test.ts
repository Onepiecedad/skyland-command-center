/**
 * Filtret får dölja maskineri — men aldrig ett ord Alex eller Joakim sagt.
 * Exemplen nedan är hämtade ur den faktiska tråden 9 sep.
 */
import { describe, it, expect } from 'vitest';
import { isNoiseMessage } from './messageNoise';

const dölj = (content: string, role = 'user') => isNoiseMessage({ role, content });

describe('isNoiseMessage', () => {
    it('döljer OpenClaws systeminjektion efter en omstart', () => {
        expect(dölj('[System] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool/model work.')).toBe(true);
        expect(dölj('Note: The interrupted final reply was captured: "LLM request timed out."')).toBe(true);
    });

    it('döljer minnesfilerna som lästs in i tråden', () => {
        expect(dölj('Working Buffer (Danger Zone)')).toBe(true);
        expect(dölj('Status: INACTIVE Started: —')).toBe(true);
        expect(dölj("No today's memory file")).toBe(true);
        expect(dölj('<!-- Aktiveras automatiskt vid ~60% kontextanvändning. -->')).toBe(true);
        expect(dölj('# MEMORY.md (Long-term)')).toBe(true);
    });

    it('döljer buffertfilen även när den kommer som markdown', () => {
        // Exakt så den renderades i Alex-vyn 9 sep: rubrik och fetstil.
        const md = [
            '## Working Buffer (Danger Zone)',
            '**Status:** INACTIVE **Started:** —',
            '',
            '---',
            '',
            '<!-- Aktiveras automatiskt vid ~60% kontextanvändning. -->',
        ].join('\n');
        expect(dölj(md, 'assistant')).toBe(true);
        expect(dölj('**Status:** INACTIVE **Started:** —')).toBe(true);
        expect(dölj('# Working Buffer')).toBe(true);
    });

    it('döljer verktygsresultat i JSON', () => {
        expect(dölj('{"summary": "klart", "hostname": "alex"}', 'assistant')).toBe(true);
        expect(dölj('[{"type":"text","text":"hej"}]', 'assistant')).toBe(true);
    });

    it('visar riktiga repliker, även korta och även med klammer i texten', () => {
        expect(dölj('Välkommen tillbaka, Joakim. Det verkar som att gatewayen startade om medan vi var i gång.', 'assistant')).toBe(false);
        expect(dölj('ok')).toBe(false);
        expect(dölj('Sätt {kundnamn} i mallen så fyller jag i resten.', 'assistant')).toBe(false);
        expect(dölj('Statusen på Gustav är varning just nu.', 'assistant')).toBe(false);
        // Får inte förväxlas med buffertfilens 'Status: INACTIVE'.
        expect(dölj('Status på sekvensen: aktiv, nästa steg går i morgon.', 'assistant')).toBe(false);
    });

    it('döljer tomma rader och rena systemroller', () => {
        expect(dölj('   ')).toBe(true);
        expect(dölj('vad som helst', 'system')).toBe(true);
    });
});
