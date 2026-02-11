/**
 * Supabase mock for tests.
 * Intercepts all Supabase client methods and returns configurable data.
 */

import { vi } from 'vitest';

// Chainable mock builder — each method returns `this` for chaining
function createChainableMock(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
    const mock: Record<string, unknown> = {};
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'single', 'maybeSingle', 'range', 'or', 'not', 'is', 'neq', 'ilike', 'like'];

    for (const method of methods) {
        mock[method] = vi.fn().mockReturnValue(mock);
    }

    // Terminal — resolves the chain
    mock.then = (resolve: (value: unknown) => void) => resolve(resolvedValue);

    return mock;
}

// Default mock — returns empty data
const defaultMock = createChainableMock();

export const mockSupabase = {
    from: vi.fn().mockReturnValue(defaultMock),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
};

/**
 * Configure what a specific table query should return.
 * Usage: mockTable('customers', { data: [...], error: null });
 */
export function mockTable(table: string, result: { data: unknown; error: unknown }) {
    const chain = createChainableMock(result);
    mockSupabase.from.mockImplementation((t: string) => {
        if (t === table) return chain;
        return createChainableMock();
    });
    return chain;
}

// Override the real Supabase client
vi.mock('../../services/supabase', () => ({
    supabase: mockSupabase,
}));
