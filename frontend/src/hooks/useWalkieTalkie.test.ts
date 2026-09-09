import { describe, it, expect } from 'vitest';
import { toSpeech, cleanTranscript } from './useWalkieTalkie';

describe('toSpeech', () => {
    it('strips markdown so the TTS reads words, not symbols', () => {
        const md = '## Läget\n\n- **Skindiver**: tier A\n- [Länk](https://x.se)\n\n| Namn | Steg |\n|---|---|\n| OCEANA | 2 |\n\n`kod`';
        const out = toSpeech(md);
        expect(out).not.toMatch(/[#*|`\[\]]/);
        expect(out).toContain('Skindiver: tier A');
        expect(out).toContain('Länk');
        expect(out).toContain('OCEANA');
    });

    it('never reads the execution receipt aloud', () => {
        const out = toSpeech('Du kan nå Vinnie på 070-205 08 42.\n\n---\n**Faktiskt utfört:**\n\n- ✅ get_contact');
        expect(out).toBe('Du kan nå Vinnie på 070-205 08 42.');
    });

    it('cuts at a sentence boundary near the TTS cap', () => {
        const long = Array.from({ length: 60 }, (_, i) => `Mening nummer ${i} handlar om kliniken.`).join(' ');
        const out = toSpeech(long);
        expect(out.length).toBeLessThanOrEqual(1100);
        expect(out.endsWith('.')).toBe(true);
    });
});

describe('cleanTranscript', () => {
    it('drops audio-event tags so silence never becomes a question', () => {
        expect(cleanTranscript('[outro jingle]')).toBe('');
        expect(cleanTranscript('(music) ')).toBe('');
        expect(cleanTranscript('[laughter] Visa Thomas hemsida')).toBe('Visa Thomas hemsida');
    });
});
