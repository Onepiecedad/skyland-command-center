/**
 * Ticket 21 — tester för OpenAIAdapter.chat, med mockad OpenAI-klient.
 *
 * Riskytan är svarsnormaliseringen: tool_calls → { name, arguments } med
 * JSON.parse av argument-strängen, textsvar utan verktyg, och usage-mappning.
 * Ett fel här bryter hela Alex tool-calling. Inga nätanrop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: h.create } };
    },
}));
vi.mock('../services/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { OpenAIAdapter } from './openaiAdapter';

const baseInput = {
    systemPrompt: 'du är alex',
    messages: [{ role: 'user' as const, content: 'hej' }],
};

beforeEach(() => {
    h.create.mockReset();
});

describe('OpenAIAdapter.chat', () => {
    it('normaliserar ett tool_call-svar (arguments JSON→objekt)', async () => {
        h.create.mockResolvedValue({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{
                        type: 'function',
                        function: { name: 'get_contact', arguments: '{"id":"c-1"}' },
                    }],
                },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

        const out = await new OpenAIAdapter().chat(baseInput);

        expect(out.toolCalls).toEqual([{ name: 'get_contact', arguments: { id: 'c-1' } }]);
        expect(out.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it('returnerar text utan toolCalls när modellen inte kallar verktyg', async () => {
        h.create.mockResolvedValue({
            choices: [{ message: { content: 'Hej! Hur kan jag hjälpa?', tool_calls: undefined } }],
            usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
        });

        const out = await new OpenAIAdapter().chat(baseInput);

        expect(out.text).toBe('Hej! Hur kan jag hjälpa?');
        expect(out.toolCalls).toBeUndefined();
    });

    it('skickar tools + tool_choice=auto när verktyg finns med', async () => {
        h.create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }], usage: undefined });

        await new OpenAIAdapter().chat({
            ...baseInput,
            tools: [{
                name: 'ping',
                description: 'pinga',
                parameters: { type: 'object', properties: {} },
            }],
        });

        const callArg = h.create.mock.calls[0][0];
        expect(callArg.tool_choice).toBe('auto');
        expect(callArg.tools).toHaveLength(1);
        expect(callArg.tools[0]).toMatchObject({ type: 'function', function: { name: 'ping' } });
    });

    it('propagerar fel från OpenAI-anropet', async () => {
        h.create.mockRejectedValue(new Error('rate limited'));
        await expect(new OpenAIAdapter().chat(baseInput)).rejects.toThrow(/rate limited/);
    });
});
