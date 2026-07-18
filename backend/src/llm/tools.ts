/**
 * Server-side Tool Definitions and Handlers
 * Ticket 21 - Alex AI Integration
 */

import type { ToolDefinition } from './adapter';
import { supabase } from '../services/supabase';
import { enrollContact } from '../services/sequenceEvents';

// ============================================================================
// Tool Definitions (for LLM function calling)
// ============================================================================

export const ALEX_TOOLS: ToolDefinition[] = [
    {
        name: 'get_customer_status',
        description: 'Hämta status och information för en specifik kund. Använd detta för att få översikt över kundens nuvarande tillstånd, fel, varningar och öppna tasks.',
        parameters: {
            type: 'object',
            properties: {
                customer_id: {
                    type: 'string',
                    description: 'Kundens UUID (om känt)'
                },
                slug: {
                    type: 'string',
                    description: 'Kundens slug (t.ex. "thomas", "axel", "gustav")'
                },
                name: {
                    type: 'string',
                    description: 'Kundens namn (för sökning)'
                }
            }
        }
    },
    {
        name: 'list_recent_activities',
        description: 'Lista senaste aktiviteter i systemet. Kan filtreras på kund.',
        parameters: {
            type: 'object',
            properties: {
                customer_id: {
                    type: 'string',
                    description: 'Kundens UUID för att filtrera aktiviteter (valfritt, null för alla)'
                },
                limit: {
                    type: 'string',
                    description: 'Max antal aktiviteter att hämta (default: 10, max: 50)'
                }
            }
        }
    },
    {
        name: 'create_task_proposal',
        description: 'Skapa ett nytt task-förslag som kräver godkännande. Tasken skapas med status=review och måste godkännas av operatören innan den körs. FÖR KUNDSPECIFIKA TASKS MÅSTE customer_slug ELLER customer_id ANGES.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Titel på tasken (kort beskrivning av vad som ska göras)'
                },
                customer_slug: {
                    type: 'string',
                    description: 'Kundens slug (t.ex. "thomas", "axel", "gustav") - FÖREDRA DETTA över customer_id'
                },
                customer_id: {
                    type: 'string',
                    description: 'Kundens UUID (endast om slug inte är tillgängligt)'
                },
                executor: {
                    type: 'string',
                    description: 'Vilken executor som ska köra tasken',
                    enum: ['n8n:research', 'claw:research', 'claw:deep-research', 'claw:report-writer', 'n8n:content', 'local:echo']
                },
                input: {
                    type: 'string',
                    description: 'JSON-objekt med input-data till tasken (t.ex. {"query": "konkurrenter"})'
                },
                priority: {
                    type: 'string',
                    description: 'Prioritet på tasken',
                    enum: ['low', 'normal', 'high', 'urgent']
                },
                description: {
                    type: 'string',
                    description: 'Längre beskrivning av tasken (valfritt)'
                }
            },
            required: ['title', 'executor']
        }
    },
    {
        name: 'list_open_tasks',
        description: 'Lista öppna tasks som inte är avslutade. Kan filtreras på kund.',
        parameters: {
            type: 'object',
            properties: {
                customer_id: {
                    type: 'string',
                    description: 'Kundens UUID för att filtrera tasks (valfritt)'
                },
                limit: {
                    type: 'string',
                    description: 'Max antal tasks att hämta (default: 10, max: 50)'
                }
            }
        }
    },
    {
        name: 'get_customer_errors',
        description: 'Hämta senaste fel och varningar för en kund. Använd detta för att förstå VARFÖR en kund har error- eller warning-status. Returnerar detaljer om vad som gått fel.',
        parameters: {
            type: 'object',
            properties: {
                customer_slug: {
                    type: 'string',
                    description: 'Kundens slug (t.ex. "thomas", "axel", "gustav")'
                },
                customer_id: {
                    type: 'string',
                    description: 'Kundens UUID (endast om slug inte är tillgängligt)'
                },
                hours: {
                    type: 'string',
                    description: 'Hur många timmar tillbaka att söka (default: 24)'
                }
            }
        }
    },
    {
        name: 'list_contacts',
        description: 'Lista kontakter i CRM:et. Kan filtreras på status (new/working/qualified/won/lost), prospekt-tier (A/B/C) och fritextsökning på namn/e-post/företag. Returnerar även score, tier och bokningsflöde för prospekt. OBS: listan är begränsad (default 20) — använd total_count i svaret för totalsiffror, eller get_crm_stats för aggregat.',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    description: 'Filtrera på status',
                    enum: ['new', 'working', 'qualified', 'won', 'lost']
                },
                tier: {
                    type: 'string',
                    description: 'Filtrera på prospekt-tier (taggen tier:A/B/C). Tier-filtrerade listor sorteras på score.',
                    enum: ['A', 'B', 'C']
                },
                search: {
                    type: 'string',
                    description: 'Fritextsökning på namn, e-post eller företag'
                },
                tag: {
                    type: 'string',
                    description: 'Filtrera på exakt tagg, t.ex. "niche:tattoo" (alla tatuerar-prospekt), "prospect", "area:goteborg". Använd detta istället för fritextsökning för kategorier.'
                },
                missing_email: {
                    type: 'string',
                    description: 'Sätt till "true" för att bara visa kontakter som SAKNAR e-postadress (t.ex. inför berikning)',
                    enum: ['true', 'false']
                },
                limit: {
                    type: 'string',
                    description: 'Max antal (default: 20, max: 100)'
                }
            }
        }
    },
    {
        name: 'get_crm_stats',
        description: 'Aggregerade CRM-siffror: totalt antal kontakter, fördelning per status och tier, samt antal opportunities per pipeline och stage. Använd ALLTID detta för frågor som "hur många kontakter/studios/prospekt har vi?", "hur många har vi kontaktat?", "hur ser tratten ut?" — gissa aldrig utifrån listor.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'get_contact',
        description: 'Hämta en enskild kontakt med alla fält (inkl. score, bokningsflöde, Instagram, adress, DM-hook) samt kontaktens opportunities med pipeline och stage. Ange contact_id, eller sök med email/name.',
        parameters: {
            type: 'object',
            properties: {
                contact_id: { type: 'string', description: 'Kontaktens UUID' },
                email: { type: 'string', description: 'Sök på e-post (om id saknas)' },
                name: { type: 'string', description: 'Sök på namn (om id saknas)' }
            }
        }
    },
    {
        name: 'update_contact',
        description: 'Uppdatera fält på en kontakt: status, telefon, e-post, webb, företag, taggar samt custom-data (score, instagram, adress, dm_hook m.m.). Custom-fält MERGAS in — befintliga nycklar som inte skickas med behålls; sätt en nyckel till null för att radera den. Ändringen loggas som activity. Kräver contact_id (använd get_contact först om du bara har namnet).',
        parameters: {
            type: 'object',
            properties: {
                contact_id: { type: 'string', description: 'Kontaktens UUID (obligatoriskt)' },
                status: {
                    type: 'string',
                    description: 'Ny status',
                    enum: ['new', 'working', 'qualified', 'won', 'lost']
                },
                phone: { type: 'string', description: 'Nytt telefonnummer' },
                email: { type: 'string', description: 'Ny e-post' },
                website: { type: 'string', description: 'Ny webbadress' },
                company: { type: 'string', description: 'Nytt företagsnamn' },
                add_tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Taggar att lägga till (t.ex. ["tier:B", "contacted"])'
                },
                remove_tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Taggar att ta bort'
                },
                custom: {
                    type: 'object',
                    description: 'Custom-fält att merga in (t.ex. {"instagram": "nytt_handle", "address": "..."}). null som värde raderar nyckeln.'
                }
            },
            required: ['contact_id']
        }
    },
    {
        name: 'list_opportunities',
        description: 'Lista opportunities i en pipeline, t.ex. alla prospekt i en viss stage. Filtrera på pipeline-namn (t.ex. "Prospecting"), stage-namn (t.ex. "Contacted") och status. Returnerar kontaktnamn, score och stage per opportunity.',
        parameters: {
            type: 'object',
            properties: {
                pipeline: {
                    type: 'string',
                    description: 'Pipeline-namn, delmatchning räcker (t.ex. "Prospecting" eller "Sales")'
                },
                stage: {
                    type: 'string',
                    description: 'Stage-namn, delmatchning räcker (t.ex. "Contacted", "Meeting Booked")'
                },
                status: {
                    type: 'string',
                    description: 'Filtrera på status (default: alla)',
                    enum: ['open', 'won', 'lost']
                },
                limit: {
                    type: 'string',
                    description: 'Max antal (default: 50, max: 100)'
                }
            }
        }
    },
    {
        name: 'move_opportunity',
        description: 'Flytta en opportunity till en annan stage i pipelinen. Detta är en kund-påverkande skrivning och loggas som activity. Ange opportunity_id och stage_id.',
        parameters: {
            type: 'object',
            properties: {
                opportunity_id: { type: 'string', description: 'Opportunityns UUID' },
                stage_id: { type: 'string', description: 'Mål-stagens UUID' }
            },
            required: ['opportunity_id', 'stage_id']
        }
    },
    {
        name: 'log_interaction',
        description: 'Logga en interaktion (t.ex. samtal, mötesanteckning, notering) mot en kontakt. Skapar ett message i kontaktens tråd så det syns i unified inbox.',
        parameters: {
            type: 'object',
            properties: {
                contact_id: { type: 'string', description: 'Kontaktens UUID' },
                content: { type: 'string', description: 'Vad som hände / vad som sades' },
                channel: {
                    type: 'string',
                    description: 'Kanal för interaktionen (default: chat)',
                    enum: ['chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook']
                }
            },
            required: ['contact_id', 'content']
        }
    },
    {
        name: 'navigate_ui',
        description: 'Styr operatörens dashboard-UI: byt vy och/eller öppna ett specifikt kontaktkort. Använd när operatören säger t.ex. "visa CRM:et", "öppna kontoret", "visa kortet för All Gold Tattoo", "ta fram prospektkortet för X". Om contact_query anges öppnas CRM-vyn med det kortets detaljpanel. Vyer: alex (chatten), crm (kanban-pipelinen), leads, sequences (sekvenser), customers (kundinstanser), website (hemsidan), office (kontoret), archive (arkivet), system (systemöversikt), skills. Verktyget påverkar bara skärmen — det ändrar ingen data och är alltid säkert att köra direkt.',
        parameters: {
            type: 'object',
            properties: {
                view: {
                    type: 'string',
                    enum: ['alex', 'crm', 'leads', 'sequences', 'customers', 'website', 'office', 'archive', 'system', 'skills'],
                    description: 'Vyn som ska visas. Vid contact_query: utelämna eller sätt "crm".'
                },
                contact_query: { type: 'string', description: 'Namn på kontakt/studio vars kort ska öppnas, t.ex. "All Gold Tattoo". Fuzzy-matchas mot CRM:et.' }
            }
        }
    },
    {
        name: 'list_sequences',
        description: 'Lista automations-sekvenser (cold email-drip, strategisamtal-påminnelser, no-show-uppföljning) med status (draft/active/paused), trigger och antal aktiva enrollments. Använd för att se vilka sekvenser som finns och om de körs.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'enroll_in_sequence',
        description: 'Skriv in en kontakt i en sekvens, t.ex. starta cold email-drippen för ett prospekt. Ange contact_id och sequence_id. Sekvensen kör bara om den är aktiv, och utskick kräver dessutom att OUTBOUND_ENABLED är på — så detta är säkert att köra.',
        parameters: {
            type: 'object',
            properties: {
                contact_id: { type: 'string', description: 'Kontaktens UUID' },
                sequence_id: { type: 'string', description: 'Sekvensens UUID (se list_sequences)' }
            },
            required: ['contact_id', 'sequence_id']
        }
    }
];

// ============================================================================
// Tool Handlers
// ============================================================================

export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(
    name: string,
    args: Record<string, unknown>
): Promise<ToolResult> {
    try {
        switch (name) {
            case 'get_customer_status':
                return await handleGetCustomerStatus(args);
            case 'list_recent_activities':
                return await handleListRecentActivities(args);
            case 'create_task_proposal':
                return await handleCreateTaskProposal(args);
            case 'list_open_tasks':
                return await handleListOpenTasks(args);
            case 'get_customer_errors':
                return await handleGetCustomerErrors(args);
            case 'list_contacts':
                return await handleListContacts(args);
            case 'get_crm_stats':
                return await handleGetCrmStats();
            case 'get_contact':
                return await handleGetContact(args);
            case 'update_contact':
                return await handleUpdateContact(args);
            case 'list_opportunities':
                return await handleListOpportunities(args);
            case 'move_opportunity':
                return await handleMoveOpportunity(args);
            case 'log_interaction':
                return await handleLogInteraction(args);
            case 'list_sequences':
                return await handleListSequences();
            case 'enroll_in_sequence':
                return await handleEnrollInSequence(args);
            case 'navigate_ui':
                return await handleNavigateUi(args);
            default:
                return { success: false, error: `Unknown tool: ${name}` };
        }
    } catch (err) {
        console.error(`[tools] Error executing ${name}:`, err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
        };
    }
}

// ============================================================================
// Individual Tool Handlers
// ============================================================================

async function handleGetCustomerStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const { customer_id, slug, name } = args;

    let query = supabase.from('customer_status').select('*');

    if (customer_id) {
        query = query.eq('id', customer_id);
    } else if (slug) {
        query = query.eq('slug', String(slug).toLowerCase());
    } else if (name) {
        query = query.ilike('name', `%${name}%`);
    } else {
        // No filter - return all customers
        const { data, error } = await query;
        if (error) return { success: false, error: error.message };
        return { success: true, data: { customers: data, count: data?.length || 0 } };
    }

    const { data, error } = await query.single();
    if (error) {
        if (error.code === 'PGRST116') {
            return { success: false, error: 'Kund hittades inte' };
        }
        return { success: false, error: error.message };
    }

    return { success: true, data };
}

async function handleListRecentActivities(args: Record<string, unknown>): Promise<ToolResult> {
    const customerId = args.customer_id as string | undefined;
    const limit = Math.min(parseInt(String(args.limit || '10'), 10), 50);

    let query = supabase
        .from('activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (customerId) {
        query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    return { success: true, data: { activities: data, count: data?.length || 0 } };
}

async function handleCreateTaskProposal(args: Record<string, unknown>): Promise<ToolResult> {
    const { title, customer_slug, customer_id, executor, input, priority, description } = args;

    if (!title || !executor) {
        return { success: false, error: 'title och executor krävs' };
    }

    // Resolve customer_id from slug if provided
    let resolvedCustomerId: string | null = null;

    if (customer_slug) {
        // Look up customer by slug
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('id')
            .eq('slug', String(customer_slug).toLowerCase())
            .single();

        if (customerError || !customer) {
            return { success: false, error: `Kunde ej hitta kund med slug "${customer_slug}"` };
        }
        resolvedCustomerId = customer.id;
    } else if (customer_id) {
        // Use provided UUID directly
        resolvedCustomerId = String(customer_id);
    }

    // Parse input if it's a string
    let inputData: Record<string, unknown> = {};
    if (input) {
        try {
            inputData = typeof input === 'string' ? JSON.parse(input) : (input as Record<string, unknown>);
        } catch {
            inputData = { raw: input };
        }
    }

    // Add source metadata
    inputData.source = 'alex_chat';
    inputData.created_via = 'llm_tool_call';

    // GUARDRAIL: Always create with status='review'
    const { data, error } = await supabase
        .from('tasks')
        .insert({
            title: String(title),
            customer_id: resolvedCustomerId,
            executor: String(executor),
            status: 'review', // ALWAYS review - this is a MUST guardrail
            priority: String(priority || 'normal'),
            description: description ? String(description) : null,
            input: inputData
        })
        .select()
        .single();

    if (error) return { success: false, error: error.message };

    return {
        success: true,
        data: {
            task_id: data.id,
            title: data.title,
            status: data.status,
            message: 'Task skapad med status=review. Kräver godkännande innan den körs.'
        }
    };
}

async function handleListOpenTasks(args: Record<string, unknown>): Promise<ToolResult> {
    const customerId = args.customer_id as string | undefined;
    const limit = Math.min(parseInt(String(args.limit || '10'), 10), 50);

    let query = supabase
        .from('tasks')
        .select('id, title, status, priority, executor, customer_id, created_at')
        .in('status', ['created', 'assigned', 'in_progress', 'review'])
        .order('created_at', { ascending: false })
        .limit(limit);

    if (customerId) {
        query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    return { success: true, data: { tasks: data, count: data?.length || 0 } };
}

async function handleGetCustomerErrors(args: Record<string, unknown>): Promise<ToolResult> {
    const { customer_slug, customer_id, hours } = args;
    const hoursBack = parseInt(String(hours || '24'), 10);

    // Resolve customer_id from slug if provided
    let resolvedCustomerId: string | null = null;

    if (customer_slug) {
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('id, name')
            .eq('slug', String(customer_slug).toLowerCase())
            .single();

        if (customerError || !customer) {
            return { success: false, error: `Kunde ej hitta kund med slug "${customer_slug}"` };
        }
        resolvedCustomerId = customer.id;
    } else if (customer_id) {
        resolvedCustomerId = String(customer_id);
    } else {
        return { success: false, error: 'customer_slug eller customer_id krävs' };
    }

    // Calculate time threshold
    const since = new Date();
    since.setHours(since.getHours() - hoursBack);

    // Fetch errors and warnings
    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('customer_id', resolvedCustomerId)
        .in('severity', ['error', 'warning'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) return { success: false, error: error.message };

    const errors = data?.filter(a => a.severity === 'error') || [];
    const warnings = data?.filter(a => a.severity === 'warning') || [];

    return {
        success: true,
        data: {
            errors,
            warnings,
            error_count: errors.length,
            warning_count: warnings.length,
            hours_checked: hoursBack
        }
    };
}

// ============================================================================
// Helper: Format tool results for LLM context
// ============================================================================

// ----------------------------------------------------------------------------
// SCC-27 — CRM tool handlers
// ----------------------------------------------------------------------------

async function handleListContacts(args: Record<string, unknown>): Promise<ToolResult> {
    const status = args.status as string | undefined;
    const tier = args.tier ? String(args.tier).toUpperCase() : undefined;
    const search = args.search ? String(args.search).trim() : undefined;
    const tag = args.tag ? String(args.tag).trim() : undefined;
    const missingEmail = String(args.missing_email ?? '') === 'true';
    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 100);

    // count: 'exact' — totalen oavsett limit, så modellen aldrig tar en
    // trunkerad lista för hela sanningen (gav tidigare fel svar som "totalt 25").
    let query = supabase
        .from('contacts')
        .select('id, name, email, company, status, tags, custom, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status) query = query.eq('status', status);
    if (tier) query = query.contains('tags', [`tier:${tier}`]);
    if (tag) query = query.contains('tags', [tag]);
    if (missingEmail) query = query.or('email.is.null,email.eq.');
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) return { success: false, error: error.message };

    const contacts = data ?? [];
    if (tier) {
        contacts.sort((a, b) => {
            const scoreOf = (c: { custom?: unknown }) => {
                const custom = c.custom as { score?: number } | null | undefined;
                return typeof custom?.score === 'number' ? custom.score : -1;
            };
            return scoreOf(b) - scoreOf(a);
        });
    }
    const total = count ?? contacts.length;
    return { success: true, data: { contacts, count: contacts.length, total_count: total, truncated: total > contacts.length } };
}

/** Aggregerade CRM-siffror — grundade svar på "hur många …?" utan gissningar. */
async function handleGetCrmStats(): Promise<ToolResult> {
    const [contactsRes, oppsRes] = await Promise.all([
        supabase.from('contacts').select('status, tags, email', { count: 'exact' }),
        supabase.from('opportunities').select('status, stage:stages(name), pipeline:pipelines(name)'),
    ]);
    if (contactsRes.error) return { success: false, error: contactsRes.error.message };
    if (oppsRes.error) return { success: false, error: oppsRes.error.message };

    const byStatus: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    let missingEmail = 0;
    for (const c of (contactsRes.data ?? []) as Array<{ status: string; tags: string[] | null; email?: string | null }>) {
        byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
        const tier = c.tags?.find(t => t.startsWith('tier:'))?.slice(5);
        if (tier) byTier[tier] = (byTier[tier] ?? 0) + 1;
        if (!c.email) missingEmail++;
    }

    const byStage: Record<string, number> = {};
    for (const o of (oppsRes.data ?? []) as Array<{ stage: { name?: string } | null; pipeline: { name?: string } | null }>) {
        const key = `${o.pipeline?.name ?? 'okänd pipeline'} → ${o.stage?.name ?? 'okänd stage'}`;
        byStage[key] = (byStage[key] ?? 0) + 1;
    }

    return {
        success: true,
        data: {
            total_contacts: contactsRes.count ?? 0,
            contacts_by_status: byStatus,
            contacts_by_tier: byTier,
            contacts_missing_email: missingEmail,
            opportunities_total: (oppsRes.data ?? []).length,
            opportunities_by_stage: byStage,
        }
    };
}

async function handleGetContact(args: Record<string, unknown>): Promise<ToolResult> {
    const { contact_id, email, name } = args;

    let query = supabase.from('contacts').select('*');
    if (contact_id) query = query.eq('id', contact_id);
    else if (email) query = query.ilike('email', `%${email}%`);
    else if (name) query = query.ilike('name', `%${name}%`);
    else return { success: false, error: 'Ange contact_id, email eller name' };

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!data) return { success: false, error: 'Kontakt hittades inte' };

    const { data: opportunities, error: oppError } = await supabase
        .from('opportunities')
        .select('id, title, status, value_sek, stage:stages(name), pipeline:pipelines(name)')
        .eq('contact_id', data.id);
    if (oppError) return { success: false, error: oppError.message };

    return { success: true, data: { ...data, opportunities: opportunities ?? [] } };
}

async function handleUpdateContact(args: Record<string, unknown>): Promise<ToolResult> {
    const contactId = args.contact_id ? String(args.contact_id) : undefined;
    if (!contactId) return { success: false, error: 'contact_id krävs — använd get_contact för att hitta id först' };

    const { data: existing, error: fetchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();
    if (fetchError) return { success: false, error: fetchError.message };
    if (!existing) return { success: false, error: 'Kontakt hittades inte' };

    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];

    const VALID_STATUSES = ['new', 'working', 'qualified', 'won', 'lost'];
    if (args.status !== undefined) {
        const status = String(args.status);
        if (!VALID_STATUSES.includes(status)) {
            return { success: false, error: `Ogiltig status "${status}". Tillåtna: ${VALID_STATUSES.join(', ')}` };
        }
        updates.status = status;
        changedFields.push('status');
    }

    for (const field of ['phone', 'email', 'website', 'company'] as const) {
        if (args[field] !== undefined) {
            updates[field] = String(args[field]);
            changedFields.push(field);
        }
    }

    const addTags = Array.isArray(args.add_tags) ? (args.add_tags as string[]).map(String) : [];
    const removeTags = Array.isArray(args.remove_tags) ? (args.remove_tags as string[]).map(String) : [];
    if (addTags.length > 0 || removeTags.length > 0) {
        const currentTags: string[] = Array.isArray(existing.tags) ? existing.tags : [];
        const newTags = [...new Set([...currentTags.filter(t => !removeTags.includes(t)), ...addTags])].sort();
        updates.tags = newTags;
        changedFields.push('tags');
    }

    if (args.custom !== undefined && typeof args.custom === 'object' && args.custom !== null) {
        const patch = args.custom as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...(existing.custom as Record<string, unknown> | null ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete merged[key];
            else merged[key] = value;
        }
        updates.custom = merged;
        changedFields.push(`custom (${Object.keys(patch).join(', ')})`);
    }

    if (changedFields.length === 0) {
        return { success: false, error: 'Inga fält att uppdatera angavs' };
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
        .from('contacts')
        .update(updates)
        .eq('id', contactId)
        .select('*')
        .single();
    if (updateError) return { success: false, error: updateError.message };

    await supabase.from('activities').insert({
        customer_id: existing.customer_id ?? null,
        agent: 'alex',
        action: 'contact.updated',
        event_type: 'contact',
        severity: 'info',
        autonomy_level: 'ACT',
        details: { contact_id: contactId, contact_name: existing.name, changed_fields: changedFields },
    });

    return { success: true, data: { contact: updated, changed_fields: changedFields } };
}

async function handleListOpportunities(args: Record<string, unknown>): Promise<ToolResult> {
    const pipeline = args.pipeline ? String(args.pipeline).trim() : undefined;
    const stage = args.stage ? String(args.stage).trim() : undefined;
    const status = args.status as string | undefined;
    const limit = Math.min(parseInt(String(args.limit || '50'), 10) || 50, 100);

    let pipelineId: string | undefined;
    if (pipeline) {
        const { data: p, error: pError } = await supabase
            .from('pipelines')
            .select('id, name')
            .ilike('name', `%${pipeline}%`)
            .limit(1)
            .maybeSingle();
        if (pError) return { success: false, error: pError.message };
        if (!p) return { success: false, error: `Hittade ingen pipeline som matchar "${pipeline}"` };
        pipelineId = p.id;
    }

    let stageIds: string[] | undefined;
    if (stage) {
        let stageQuery = supabase.from('stages').select('id, name').ilike('name', `%${stage}%`);
        if (pipelineId) stageQuery = stageQuery.eq('pipeline_id', pipelineId);
        const { data: stages, error: sError } = await stageQuery;
        if (sError) return { success: false, error: sError.message };
        if (!stages || stages.length === 0) return { success: false, error: `Hittade ingen stage som matchar "${stage}"` };
        stageIds = stages.map(s => s.id);
    }

    let query = supabase
        .from('opportunities')
        .select('id, title, status, value_sek, created_at, stage:stages(name), pipeline:pipelines(name), contact:contacts(id, name, tags, custom)')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (stageIds) query = query.in('stage_id', stageIds);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    const opportunities = (data ?? []).sort((a, b) => {
        const scoreOf = (o: { contact?: unknown }) => {
            const contact = o.contact as { custom?: { score?: number } | null } | null | undefined;
            return typeof contact?.custom?.score === 'number' ? contact.custom.score : -1;
        };
        return scoreOf(b) - scoreOf(a);
    });

    return { success: true, data: { opportunities, count: opportunities.length } };
}

async function handleMoveOpportunity(args: Record<string, unknown>): Promise<ToolResult> {
    const { opportunity_id, stage_id } = args;
    if (!opportunity_id || !stage_id) {
        return { success: false, error: 'opportunity_id och stage_id krävs' };
    }

    const { data, error } = await supabase
        .from('opportunities')
        .update({ stage_id, updated_at: new Date().toISOString() })
        .eq('id', opportunity_id)
        .select('*, stage:stages(name)')
        .single();
    if (error) return { success: false, error: error.message };
    if (!data) return { success: false, error: 'Opportunity hittades inte' };

    const stageName = (data.stage as { name?: string } | null)?.name ?? String(stage_id);

    await supabase.from('activities').insert({
        customer_id: data.customer_id ?? null,
        agent: 'alex',
        action: 'opportunity.moved',
        event_type: 'opportunity',
        severity: 'info',
        autonomy_level: 'ACT',
        details: { opportunity_id: data.id, title: data.title, stage_id, stage_name: stageName },
    });

    return { success: true, data: { opportunity_id: data.id, title: data.title, stage_name: stageName } };
}

async function handleLogInteraction(args: Record<string, unknown>): Promise<ToolResult> {
    const { contact_id, content, channel } = args;
    if (!contact_id || !content) {
        return { success: false, error: 'contact_id och content krävs' };
    }

    const { data: contact, error: cErr } = await supabase
        .from('contacts')
        .select('id, customer_id')
        .eq('id', contact_id)
        .maybeSingle();
    if (cErr) return { success: false, error: cErr.message };
    if (!contact) return { success: false, error: 'Kontakt hittades inte' };

    const { data, error } = await supabase
        .from('messages')
        .insert({
            customer_id: contact.customer_id ?? null,
            role: 'system',
            channel: (channel as string) || 'chat',
            direction: 'internal',
            content: String(content),
            metadata: { contact_id: contact.id, logged_by: 'alex' },
        })
        .select('id')
        .single();
    if (error) return { success: false, error: error.message };

    return { success: true, data: { message_id: data.id, contact_id: contact.id } };
}

async function handleListSequences(): Promise<ToolResult> {
    const { data, error } = await supabase
        .from('sequences').select('id, name, status, trigger_type').order('created_at', { ascending: false });
    if (error) return { success: false, error: error.message };
    const { data: enr } = await supabase.from('sequence_enrollments').select('sequence_id, status').eq('status', 'active');
    const counts: Record<string, number> = {};
    for (const e of (enr ?? []) as Array<{ sequence_id: string }>) counts[e.sequence_id] = (counts[e.sequence_id] ?? 0) + 1;
    return {
        success: true,
        data: { sequences: (data ?? []).map((s: Record<string, unknown>) => ({ ...s, active_enrollments: counts[s.id as string] ?? 0 })) },
    };
}

async function handleEnrollInSequence(args: Record<string, unknown>): Promise<ToolResult> {
    const contactId = String(args.contact_id ?? '');
    const sequenceId = String(args.sequence_id ?? '');
    if (!contactId || !sequenceId) return { success: false, error: 'contact_id och sequence_id krävs' };
    const { data: seq } = await supabase.from('sequences').select('name, status').eq('id', sequenceId).maybeSingle();
    if (!seq) return { success: false, error: `Sekvens ${sequenceId} hittades inte` };
    const r = await enrollContact(sequenceId, contactId);
    return { success: true, data: { enrolled: r.enrolled, reason: r.reason, sequence: (seq as { name: string }).name, status: (seq as { status: string }).status } };
}

/**
 * navigate_ui — styr dashboardens UI via SSE-eventhubben. Fungerar för både
 * textchatten och rösten (röstens verktygssvar går till ElevenLabs, inte
 * webbläsaren — SSE är den enda kanal som alltid når skärmen).
 */
const NAVIGATE_VIEWS = new Set(['alex', 'crm', 'leads', 'sequences', 'customers', 'website', 'office', 'archive', 'system', 'skills']);

async function handleNavigateUi(args: Record<string, unknown>): Promise<ToolResult> {
    const { emitSystemEvent } = await import('../routes/eventStream');
    const contactQuery = typeof args.contact_query === 'string' ? args.contact_query.trim() : '';
    let view = typeof args.view === 'string' && NAVIGATE_VIEWS.has(args.view) ? args.view : '';

    let contact: { id: string; name: string } | null = null;
    if (contactQuery) {
        view = 'crm'; // kontaktkort bor i CRM-vyn
        const { data: exact } = await supabase
            .from('contacts')
            .select('id, name')
            .ilike('name', `%${contactQuery}%`)
            .limit(2);
        if (exact && exact.length > 0) {
            contact = exact[0];
        } else {
            // Fuzzy-fallback: första ordet (samma mönster som find_contact i pipelinen)
            const firstWord = contactQuery.split(/\s+/)[0];
            const { data: fuzzy } = await supabase
                .from('contacts')
                .select('id, name')
                .ilike('name', `%${firstWord}%`)
                .limit(2);
            if (fuzzy && fuzzy.length > 0) contact = fuzzy[0];
        }
        if (!contact) {
            return { success: false, error: `Hittade ingen kontakt som matchar "${contactQuery}" i CRM:et.` };
        }
    }

    if (!view) {
        return { success: false, error: 'Ange antingen view eller contact_query.' };
    }

    emitSystemEvent('ui_action', {
        action: 'navigate',
        view,
        contact_id: contact?.id ?? null,
        contact_name: contact?.name ?? null,
    }, 'alex');

    return { success: true, data: { view, contact_name: contact?.name ?? null } };
}

export function formatToolResultForLLM(name: string, result: ToolResult): string {
    if (!result.success) {
        return `Verktyg "${name}" misslyckades: ${result.error}`;
    }

    const data = result.data;
    if (!data) return `Verktyg "${name}" returnerade inget resultat.`;

    // Format based on tool type
    switch (name) {
        case 'get_customer_status': {
            const customer = data as Record<string, unknown>;
            if ('customers' in customer) {
                const customers = (customer as { customers: Array<{ name: string; slug: string; status: string }> }).customers;
                return `Hittade ${customers.length} kunder:\n${customers.map(c => `- ${c.name} (${c.slug}): ${c.status}`).join('\n')}`;
            }
            return `Kund: ${customer.name} (${customer.slug})\nStatus: ${customer.status}\nFel (24h): ${customer.errors_24h}\nVarningar (24h): ${customer.warnings_24h}\nÖppna tasks: ${customer.open_tasks}`;
        }
        case 'list_recent_activities': {
            const result = data as { activities: Array<{ event_type: string; action: string; created_at: string; severity: string }>; count: number };
            if (result.count === 0) return 'Inga aktiviteter hittades.';
            return `Senaste ${result.count} aktiviteter:\n${result.activities.map(a =>
                `- [${a.severity}] ${a.event_type}: ${a.action} (${new Date(a.created_at).toLocaleString('sv-SE')})`
            ).join('\n')}`;
        }
        case 'create_task_proposal': {
            const task = data as { task_id: string; title: string; message: string };
            return `✅ Task skapad!\nID: ${task.task_id}\nTitel: ${task.title}\n${task.message}`;
        }
        case 'list_open_tasks': {
            const result = data as { tasks: Array<{ title: string; status: string; priority: string; executor: string }>; count: number };
            if (result.count === 0) return 'Inga öppna tasks hittades.';
            return `${result.count} öppna tasks:\n${result.tasks.map(t =>
                `- ${t.title} [${t.status}] (${t.priority}, ${t.executor})`
            ).join('\n')}`;
        }
        case 'get_customer_errors': {
            const errResult = data as {
                errors: Array<{ event_type: string; action: string; created_at: string; details?: Record<string, unknown> }>;
                warnings: Array<{ event_type: string; action: string; created_at: string; details?: Record<string, unknown> }>;
                error_count: number;
                warning_count: number;
                hours_checked: number;
            };

            if (errResult.error_count === 0 && errResult.warning_count === 0) {
                return `Inga fel eller varningar hittades de senaste ${errResult.hours_checked} timmarna.`;
            }

            let output = `Fel och varningar (senaste ${errResult.hours_checked}h):\n`;

            if (errResult.error_count > 0) {
                output += `\n🔴 FEL (${errResult.error_count}):\n`;
                errResult.errors.forEach(e => {
                    const time = new Date(e.created_at).toLocaleString('sv-SE');
                    const details = e.details ? ` - ${JSON.stringify(e.details)}` : '';
                    output += `- [${time}] ${e.event_type}: ${e.action}${details}\n`;
                });
            }

            if (errResult.warning_count > 0) {
                output += `\n⚠️ VARNINGAR (${errResult.warning_count}):\n`;
                errResult.warnings.forEach(w => {
                    const time = new Date(w.created_at).toLocaleString('sv-SE');
                    output += `- [${time}] ${w.event_type}: ${w.action}\n`;
                });
            }

            return output.trim();
        }
        case 'list_contacts': {
            const r = data as {
                contacts: Array<{
                    name: string | null;
                    email: string | null;
                    company: string | null;
                    status: string;
                    tags?: string[] | null;
                    custom?: { score?: number; booking_flow?: string } | null;
                }>;
                count: number;
                total_count?: number;
                truncated?: boolean;
            };
            if (r.count === 0) return 'Inga kontakter hittades.';
            const total = r.total_count ?? r.count;
            const header = r.truncated
                ? `TOTALT ${total} kontakter matchar — visar de ${r.count} senaste (använd total_count som totalsiffra, INTE listlängden):`
                : `${total} kontakter:`;
            return `${header}\n${r.contacts.map(c => {
                const tier = c.tags?.find(t => t.startsWith('tier:'))?.slice(5);
                const extras = [
                    typeof c.custom?.score === 'number' ? `score ${c.custom.score}` : null,
                    tier ? `tier ${tier}` : null,
                    c.custom?.booking_flow ? `bokning: ${c.custom.booking_flow}` : null,
                ].filter(Boolean).join(', ');
                return `- ${c.name || '(namnlös)'}${c.company ? ` @ ${c.company}` : ''}${c.email ? ` <${c.email}>` : ''} [${c.status}]${extras ? ` (${extras})` : ''}`;
            }).join('\n')}`;
        }
        case 'get_crm_stats': {
            const s = data as {
                total_contacts: number;
                contacts_by_status: Record<string, number>;
                contacts_by_tier: Record<string, number>;
                contacts_missing_email?: number;
                opportunities_total: number;
                opportunities_by_stage: Record<string, number>;
            };
            const fmt = (rec: Record<string, number>) =>
                Object.entries(rec).map(([k, v]) => `  - ${k}: ${v}`).join('\n') || '  (inga)';
            return [
                `Totalt antal kontakter: ${s.total_contacts}`,
                `Saknar e-post: ${s.contacts_missing_email ?? 'okänt'}`,
                `Per status:\n${fmt(s.contacts_by_status)}`,
                `Per tier:\n${fmt(s.contacts_by_tier)}`,
                `Opportunities totalt: ${s.opportunities_total}`,
                `Per pipeline/stage:\n${fmt(s.opportunities_by_stage)}`,
            ].join('\n');
        }
        case 'get_contact': {
            const c = data as Record<string, unknown>;
            const custom = (c.custom ?? {}) as Record<string, unknown>;
            const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
            const lines = [
                `Kontakt: ${c.name || '(namnlös)'}`,
                `Företag: ${c.company || '—'}`,
                `E-post: ${c.email || custom.email || '—'}`,
                `Telefon: ${c.phone || '—'}`,
                `Status: ${c.status}`,
            ];
            if (tags.length > 0) lines.push(`Taggar: ${tags.join(', ')}`);
            if (typeof custom.score === 'number') lines.push(`Score: ${custom.score}`);
            if (custom.booking_flow) lines.push(`Bokningsflöde: ${custom.booking_flow}${custom.booking_flow_verified ? ` (verifierat ${custom.booking_flow_verified})` : ''}`);
            if (custom.instagram) lines.push(`Instagram: @${custom.instagram}`);
            if (c.website || custom.website) lines.push(`Webb: ${c.website || custom.website}`);
            if (custom.address) lines.push(`Adress: ${custom.address}`);
            if (custom.rating) lines.push(`Betyg: ${custom.rating} ★${custom.reviews ? ` (${custom.reviews} omdömen)` : ''}`);
            if (custom.dm_hook) lines.push(`DM-hook: ${custom.dm_hook}${custom.dm_hook_source ? ` (källa: ${custom.dm_hook_source})` : ''}`);
            const opps = Array.isArray(c.opportunities) ? (c.opportunities as Array<Record<string, unknown>>) : [];
            if (opps.length > 0) {
                lines.push('Pipeline-läge:');
                for (const o of opps) {
                    const stageName = (o.stage as { name?: string } | null)?.name ?? 'okänd stage';
                    const pipelineName = (o.pipeline as { name?: string } | null)?.name ?? 'okänd pipeline';
                    const value = typeof o.value_sek === 'number' ? ` — ${o.value_sek.toLocaleString('sv-SE')} kr` : '';
                    lines.push(`- ${o.title} [${o.status}]: ${pipelineName} → ${stageName}${value}`);
                }
            }
            return lines.join('\n');
        }
        case 'update_contact': {
            const r = data as { contact: Record<string, unknown>; changed_fields: string[] };
            return `✅ Kontakt "${r.contact.name || r.contact.id}" uppdaterad.\nÄndrade fält: ${r.changed_fields.join(', ')}\nÄndringen är loggad som activity.`;
        }
        case 'list_opportunities': {
            const r = data as {
                opportunities: Array<{
                    id: string;
                    title: string;
                    status: string;
                    value_sek: number | null;
                    stage?: { name?: string } | null;
                    pipeline?: { name?: string } | null;
                    contact?: { name?: string | null; tags?: string[] | null; custom?: { score?: number; booking_flow?: string } | null } | null;
                }>;
                count: number;
            };
            if (r.count === 0) return 'Inga opportunities hittades.';
            return `${r.count} opportunities:\n${r.opportunities.map(o => {
                const tier = o.contact?.tags?.find(t => t.startsWith('tier:'))?.slice(5);
                const extras = [
                    typeof o.contact?.custom?.score === 'number' ? `score ${o.contact.custom.score}` : null,
                    tier ? `tier ${tier}` : null,
                    typeof o.value_sek === 'number' ? `${o.value_sek.toLocaleString('sv-SE')} kr` : null,
                ].filter(Boolean).join(', ');
                return `- ${o.title} [${o.status}] — ${o.pipeline?.name ?? '?'} → ${o.stage?.name ?? '?'}${extras ? ` (${extras})` : ''} (opportunity_id: ${o.id})`;
            }).join('\n')}`;
        }
        case 'move_opportunity': {
            const o = data as { title: string; stage_name: string };
            return `✅ Flyttade "${o.title}" till stage: ${o.stage_name}`;
        }
        case 'log_interaction': {
            const m = data as { message_id: string };
            return `✅ Interaktion loggad (message ${m.message_id}). Syns nu i kontaktens tråd.`;
        }
        case 'list_sequences': {
            const r = data as { sequences: Array<{ name: string; status: string; trigger_type: string; active_enrollments: number }> };
            if (!r.sequences.length) return 'Inga sekvenser finns än.';
            return `${r.sequences.length} sekvenser:\n${r.sequences.map(s =>
                `- ${s.name} [${s.status}] · trigger: ${s.trigger_type} · ${s.active_enrollments} aktiva`).join('\n')}`;
        }
        case 'enroll_in_sequence': {
            const r = data as { enrolled: boolean; reason?: string; sequence: string; status: string };
            if (!r.enrolled) return `Kontakten var redan i "${r.sequence}" (${r.reason ?? 'skippad'}).`;
            const note = r.status !== 'active' ? ` OBS: sekvensen är "${r.status}" — inget körs förrän du aktiverar den.` : '';
            return `✅ Enrollad i "${r.sequence}".${note}`;
        }
        case 'navigate_ui': {
            const r = data as { view: string; contact_name: string | null };
            return r.contact_name
                ? `✅ Öppnade kortet för "${r.contact_name}" i CRM-vyn på skärmen.`
                : `✅ Bytte till vyn "${r.view}" på skärmen.`;
        }
        default:
            return JSON.stringify(data, null, 2);
    }
}
