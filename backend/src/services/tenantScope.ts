/**
 * Tenant-isolering, steg 2 — hur en tabell hör ihop med en kund.
 *
 * Backend kör som service_role och går förbi RLS, så filtreringen måste ske
 * här. Att strö .eq('customer_id', ...) över 29 ruttfiler är precis hur man
 * missar en. Istället: en explicit karta, och allt som inte står i den kastar.
 *
 * Kartan speglar databasen (kontrollerad 7 sep 2026):
 *  - direct: tabellen har en egen customer_id-kolumn
 *  - derived: tenancy nås via en främmande nyckel, kräver ett extra steg och
 *    är inte påslaget förrän respektive kundvy byggs
 *  - internal: Skylands eget material, aldrig synligt för en kund
 *
 * customer_id = NULL betyder Skyland internt. .eq() utesluter NULL, så en kund
 * ser ingenting förrän raden uttryckligen stämplats med hens id.
 */

import { supabase } from './supabase';
import type { Principal } from '../middleware/principal';

type TenantRule =
    | { mode: 'direct'; column: 'customer_id' }
    | { mode: 'derived'; via: string; fk: string }
    | { mode: 'internal' };

export const TENANT_MAP: Record<string, TenantRule> = {
    // Egen customer_id-kolumn
    activities: { mode: 'direct', column: 'customer_id' },
    bookings: { mode: 'direct', column: 'customer_id' },
    ce_bookings: { mode: 'direct', column: 'customer_id' },
    contacts: { mode: 'direct', column: 'customer_id' },
    deliverables: { mode: 'direct', column: 'customer_id' },
    messages: { mode: 'direct', column: 'customer_id' },
    opportunities: { mode: 'direct', column: 'customer_id' },
    pipelines: { mode: 'direct', column: 'customer_id' },
    prospects: { mode: 'direct', column: 'customer_id' },
    sequences: { mode: 'direct', column: 'customer_id' },
    tasks: { mode: 'direct', column: 'customer_id' },
    voice_calls: { mode: 'direct', column: 'customer_id' },

    // Tenancy via främmande nyckel — kräver uppslag, byggs med respektive kundvy
    costs: { mode: 'derived', via: 'tasks', fk: 'task_id' },
    sequence_enrollments: { mode: 'derived', via: 'sequences', fk: 'sequence_id' },
    sequence_steps: { mode: 'derived', via: 'sequences', fk: 'sequence_id' },
    sequence_step_runs: { mode: 'derived', via: 'sequence_enrollments', fk: 'enrollment_id' },
    stages: { mode: 'derived', via: 'pipelines', fk: 'pipeline_id' },
    studio_assets: { mode: 'derived', via: 'contacts', fk: 'contact_id' },
    suppression_list: { mode: 'derived', via: 'contacts', fk: 'contact_id' },
    task_runs: { mode: 'derived', via: 'tasks', fk: 'task_id' },
    todos: { mode: 'derived', via: 'contacts', fk: 'contact_id' },

    // Skylands eget — aldrig en kunds
    ad_library: { mode: 'internal' },
    agent_configs: { mode: 'internal' },
    customers: { mode: 'internal' },
    events: { mode: 'internal' },
    interactions: { mode: 'internal' },
    knowledge_base: { mode: 'internal' },
    sessions: { mode: 'internal' },
    tenants: { mode: 'internal' },

    // Cold Experience och mäklarsystemet har egen tenant-modell (ce_*/mk_*)
    // och scopas när de vyerna byggs.
    ce_conversations: { mode: 'internal' },
    ce_customers: { mode: 'internal' },
    ce_lead_events: { mode: 'internal' },
    ce_leads: { mode: 'internal' },
    ce_messages: { mode: 'internal' },
    ce_payments: { mode: 'internal' },
    mk_brokers: { mode: 'internal' },
    mk_crawl_pages: { mode: 'internal' },
    mk_documents: { mode: 'internal' },
    mk_lead_events: { mode: 'internal' },
    mk_leads: { mode: 'internal' },
    mk_listings: { mode: 'internal' },
    mk_viewings: { mode: 'internal' },
};

export class TenantScopeError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'TenantScopeError';
    }
}

/**
 * Avgör hur en tabell får läsas av den här anroparen.
 * Returnerar null när ingen filtrering behövs (operatören), annars kolumnen
 * och värdet som MÅSTE appliceras. Kastar hellre än gissar för allt annat.
 */
export function tenantFilter(
    principal: Principal | undefined,
    table: string,
): { column: string; value: string } | null {
    const rule = TENANT_MAP[table];
    if (!rule) {
        throw new TenantScopeError(
            `Tabellen '${table}' saknas i TENANT_MAP — lägg till den innan den används i en kundvy`,
            'unmapped_table',
        );
    }

    if (principal?.kind === 'operator') return null;

    if (principal?.kind !== 'customer') {
        throw new TenantScopeError('Anropet saknar identitet', 'missing_principal');
    }

    if (rule.mode === 'internal') {
        throw new TenantScopeError(
            `Tabellen '${table}' är Skylands eget material och kan inte läsas av en kund`,
            'internal_table',
        );
    }

    if (rule.mode === 'derived') {
        throw new TenantScopeError(
            `Tabellen '${table}' scopas via ${rule.via}.${rule.fk} och är inte påslagen för kundvyer ännu`,
            'derived_not_enabled',
        );
    }

    return { column: rule.column, value: principal.customerId };
}

/**
 * En select som redan är begränsad till anroparens kund. Operatören får
 * tabellen ofiltrerad (dagens beteende, oförändrat); en kund får ett .eq på
 * sin customer_id. Detta är vägen in för kundvyer — inte supabase.from direkt.
 */
export function scopedSelect(
    principal: Principal | undefined,
    table: string,
    columns = '*',
) {
    const filter = tenantFilter(principal, table);
    const query = supabase.from(table).select(columns);
    return filter ? query.eq(filter.column, filter.value) : query;
}

/** Kunden som en ny rad ska stämplas med, eller null när operatören skriver internt. */
export function stampCustomerId(principal: Principal | undefined): string | null {
    return principal?.kind === 'customer' ? principal.customerId : null;
}
