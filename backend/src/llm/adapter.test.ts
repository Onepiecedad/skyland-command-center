/**
 * Ticket 21 — tester för LLM-adapter-factoryns felhantering.
 *
 * OBS: createAdapter använder CommonJS require() för provider-modulerna för att
 * undvika att ladda oanvända providers. Under vitest kan require() inte resolva
 * relativa .ts-moduler, så provider-routingen (openai/deepseek/openrouter →
 * respektive klass) verifieras inte här — den fungerar efter tsc-bygget, och
 * svarsnormaliseringen täcks separat i openaiAdapter.test.ts. Här säkras enbart
 * factoryns felgrenar, som körs innan något require.
 */

import { describe, it, expect } from 'vitest';
import { createAdapter, type LLMProvider } from './adapter';

describe('createAdapter — felhantering', () => {
    it('anthropic → kastar (ej implementerad)', () => {
        expect(() => createAdapter('anthropic')).toThrow(/not yet implemented/i);
    });

    it('okänd provider → kastar tydligt', () => {
        expect(() => createAdapter('gemini' as LLMProvider)).toThrow(/Unknown LLM provider/i);
    });
});
