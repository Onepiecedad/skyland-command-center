/**
 * Tenant-isolering — tester för kartan och grinden.
 *
 * Riskerna som testas: att operatören råkar bli filtrerad (skulle tömma
 * dashboarden), att en kund råkar se Skylands eget material, och att en tabell
 * som glömts i kartan slinker igenom ofiltrerad. Det sista är hela poängen —
 * okänd tabell ska kasta, inte släppa förbi.
 */
import { describe, it, expect, vi } from 'vitest';

const calls = vi.hoisted(() => ({ eq: [] as Array<[string, unknown]> }));

vi.mock('./supabase', () => ({
    supabase: {
        from: (table: string) => ({
            select: () => ({
                table,
                eq: (col: string, val: unknown) => {
                    calls.eq.push([col, val]);
                    return { table, filtered: true };
                },
            }),
        }),
    },
}));

import { tenantFilter, scopedSelect, TenantScopeError, TENANT_MAP } from './tenantScope';
import type { Principal } from '../middleware/principal';

const operator: Principal = { kind: 'operator', source: 'token' };
const kund: Principal = { kind: 'customer', customerId: 'cust-gustav' };

describe('tenantFilter', () => {
    it('filtrerar inte för operatören', () => {
        expect(tenantFilter(operator, 'contacts')).toBeNull();
    });

    it('ger customer_id-filter för en kund på en direkt tabell', () => {
        expect(tenantFilter(kund, 'contacts')).toEqual({ column: 'customer_id', value: 'cust-gustav' });
    });

    it('kastar för en tabell som saknas i kartan', () => {
        expect(() => tenantFilter(kund, 'nagon_ny_tabell')).toThrow(TenantScopeError);
        expect(() => tenantFilter(kund, 'nagon_ny_tabell')).toThrow(/TENANT_MAP/);
    });

    it('kastar även för operatören när tabellen saknas i kartan', () => {
        // Kartan ska upptäckas som ofullständig oavsett vem som frågar
        expect(() => tenantFilter(operator, 'nagon_ny_tabell')).toThrow(/TENANT_MAP/);
    });

    it('nekar kund åtkomst till Skylands interna tabeller', () => {
        for (const t of ['customers', 'knowledge_base', 'tenants', 'ad_library']) {
            expect(() => tenantFilter(kund, t)).toThrow(/eget material/);
        }
    });

    it('nekar kund åtkomst till härledda tabeller som inte är påslagna', () => {
        expect(() => tenantFilter(kund, 'sequence_enrollments')).toThrow(/inte påslagen/);
        expect(() => tenantFilter(kund, 'task_runs')).toThrow(/inte påslagen/);
    });

    it('kastar när anropet saknar identitet helt', () => {
        expect(() => tenantFilter(undefined, 'contacts')).toThrow(/saknar identitet/);
    });
});

describe('scopedSelect', () => {
    it('lämnar queryn ofiltrerad för operatören', () => {
        calls.eq = [];
        scopedSelect(operator, 'contacts');
        expect(calls.eq).toHaveLength(0);
    });

    it('applicerar customer_id-filtret för en kund', () => {
        calls.eq = [];
        scopedSelect(kund, 'bookings');
        expect(calls.eq).toEqual([['customer_id', 'cust-gustav']]);
    });
});

describe('TENANT_MAP', () => {
    it('täcker de tabeller kundvyerna kommer att röra', () => {
        for (const t of ['contacts', 'messages', 'opportunities', 'pipelines',
            'sequences', 'bookings', 'activities', 'tasks']) {
            expect(TENANT_MAP[t], `${t} saknas i TENANT_MAP`).toBeDefined();
        }
    });

    it('har bara giltiga lägen', () => {
        for (const [table, rule] of Object.entries(TENANT_MAP)) {
            expect(['direct', 'derived', 'internal'], `${table}`).toContain(rule.mode);
        }
    });
});
