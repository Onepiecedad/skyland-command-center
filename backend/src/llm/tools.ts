/**
 * Server-side Tool Definitions and Handlers
 * Ticket 21 - Alex AI Integration
 */

import type { ToolDefinition } from './adapter';
import { supabase } from '../services/supabase';

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
        description: 'Lista kontakter i CRM:et. Kan filtreras på status (new/working/qualified/won/lost) och fritextsökning på namn/e-post/företag.',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    description: 'Filtrera på status',
                    enum: ['new', 'working', 'qualified', 'won', 'lost']
                },
                search: {
                    type: 'string',
                    description: 'Fritextsökning på namn, e-post eller företag'
                },
                limit: {
                    type: 'string',
                    description: 'Max antal (default: 20, max: 100)'
                }
            }
        }
    },
    {
        name: 'get_contact',
        description: 'Hämta en enskild kontakt med alla fält. Ange contact_id, eller sök med email/name.',
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
            case 'get_contact':
                return await handleGetContact(args);
            case 'move_opportunity':
                return await handleMoveOpportunity(args);
            case 'log_interaction':
                return await handleLogInteraction(args);
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
    const search = args.search ? String(args.search).trim() : undefined;
    const limit = Math.min(parseInt(String(args.limit || '20'), 10) || 20, 100);

    let query = supabase
        .from('contacts')
        .select('id, name, email, company, status, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };
    return { success: true, data: { contacts: data, count: data?.length || 0 } };
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
    return { success: true, data };
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
            const r = data as { contacts: Array<{ name: string | null; email: string | null; company: string | null; status: string }>; count: number };
            if (r.count === 0) return 'Inga kontakter hittades.';
            return `${r.count} kontakter:\n${r.contacts.map(c =>
                `- ${c.name || '(namnlös)'}${c.company ? ` @ ${c.company}` : ''}${c.email ? ` <${c.email}>` : ''} [${c.status}]`
            ).join('\n')}`;
        }
        case 'get_contact': {
            const c = data as Record<string, unknown>;
            return `Kontakt: ${c.name || '(namnlös)'}\nFöretag: ${c.company || '—'}\nE-post: ${c.email || '—'}\nTelefon: ${c.phone || '—'}\nStatus: ${c.status}`;
        }
        case 'move_opportunity': {
            const o = data as { title: string; stage_name: string };
            return `✅ Flyttade "${o.title}" till stage: ${o.stage_name}`;
        }
        case 'log_interaction': {
            const m = data as { message_id: string };
            return `✅ Interaktion loggad (message ${m.message_id}). Syns nu i kontaktens tråd.`;
        }
        default:
            return JSON.stringify(data, null, 2);
    }
}
