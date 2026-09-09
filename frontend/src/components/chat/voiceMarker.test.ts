import { describe, it, expect } from 'vitest';
import { withVoiceMarker, stripVoiceMarker, wasSpoken } from './voiceMarker';

describe('röstmarkören', () => {
    it('talar om för Alex att det är tal, och att svaret läses upp', () => {
        const m = withVoiceMarker('Hur många prospekt har vi?');
        expect(m).toMatch(/läses upp/);
        expect(m).toMatch(/aldrig motsatsen/);
        expect(m.endsWith('Hur många prospekt har vi?')).toBe(true);
    });

    it('visas inte för ögat — bara det som faktiskt sades', () => {
        expect(stripVoiceMarker(withVoiceMarker('Visa Thomas hemsida'))).toBe('Visa Thomas hemsida');
    });

    it('rör inte vanliga meddelanden', () => {
        expect(stripVoiceMarker('Vad är status på Gustav?')).toBe('Vad är status på Gustav?');
        expect(stripVoiceMarker('[RÖST] utan brytning')).toBe('utan brytning');
    });

    it('går att känna igen i tråden', () => {
        expect(wasSpoken(withVoiceMarker('hej'))).toBe(true);
        expect(wasSpoken('hej')).toBe(false);
    });
});
