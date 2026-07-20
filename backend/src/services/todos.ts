/**
 * Todos-service — operatörens att-göra-lista ("ska ske"-linsen).
 *
 * Delas av routes/todos.ts (manuella todos) och auto-generering från
 * pipeline-/DM-händelser (igDmWebhook, pipelines). Auto-todos dedupas på
 * `auto_key` via ett partiellt unikt index (bara en öppen per nyckel).
 */

import { supabase } from './supabase';
import { logger } from './logger';

export type TodoPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CreateTodoInput {
    title: string;
    notes?: string | null;
    dueAt?: string | null;
    priority?: TodoPriority;
    contactId?: string | null;
    opportunityId?: string | null;
    source?: string;
    autoKey?: string | null;
}

interface TodoRow {
    title: string;
    notes: string | null;
    due_at: string | null;
    priority: TodoPriority;
    contact_id: string | null;
    opportunity_id: string | null;
    source: string;
    auto_key: string | null;
}

function toRow(input: CreateTodoInput, defaultSource: string): TodoRow {
    return {
        title: input.title,
        notes: input.notes ?? null,
        due_at: input.dueAt ?? null,
        priority: input.priority ?? 'normal',
        contact_id: input.contactId ?? null,
        opportunity_id: input.opportunityId ?? null,
        source: input.source ?? defaultSource,
        auto_key: input.autoKey ?? null,
    };
}

/** Skapar en todo och returnerar raden. Kastar vid fel (för API-lagret). */
export async function createTodo(input: CreateTodoInput): Promise<Record<string, unknown>> {
    const { data, error } = await supabase
        .from('todos')
        .insert(toRow(input, 'manual'))
        .select()
        .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
}

/**
 * Best-effort auto-todo från en systemhändelse. Dedupas på öppen `auto_key`
 * (partiellt unikt index → dubblettfel 23505 sväljs). Kastar aldrig, så den
 * aldrig kan bryta det anropande flödet (webhook, stage-flytt).
 */
export async function createAutoTodo(input: CreateTodoInput & { autoKey: string }): Promise<void> {
    try {
        const { error } = await supabase.from('todos').insert(toRow(input, 'auto'));
        if (error && error.code !== '23505') {
            logger.warn('todos', `auto-todo misslyckades (${input.autoKey}): ${error.message}`);
        }
    } catch (err) {
        logger.warn('todos', `auto-todo undantag: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Skapar "Följ upp igen"-todos för kort i Contacted där öppnaren är skickad
 * men inget svar kommit på `days` dagar. Kör periodiskt (endpoint/cron).
 * Dedupas på auto_key `followup:<contact_id>` → en öppen åt gången.
 */
export async function syncFollowupTodos(days = 3): Promise<{ created: number }> {
    const cutoff = Date.now() - days * 86400000;

    // 1. Contacted-stegens id:n
    const { data: stages } = await supabase.from('stages').select('id').eq('name', 'Contacted');
    const stageIds = (stages ?? []).map((s: { id: string }) => s.id);
    if (stageIds.length === 0) return { created: 0 };

    // 2. Opportunities i Contacted
    const { data: opps } = await supabase
        .from('opportunities')
        .select('id, contact_id')
        .in('stage_id', stageIds);
    const byContact = new Map<string, string>(); // contact_id → opportunity_id
    for (const o of (opps ?? []) as { id: string; contact_id: string | null }[]) {
        if (o.contact_id) byContact.set(o.contact_id, o.id);
    }
    if (byContact.size === 0) return { created: 0 };

    // 3. IG-meddelanden för dessa kontakter (liten volym → filtrera i JS)
    const { data: msgs } = await supabase
        .from('messages')
        .select('direction, created_at, metadata')
        .eq('channel', 'instagram');

    const state = new Map<string, { hasInbound: boolean; lastOutbound: number }>();
    for (const m of (msgs ?? []) as { direction: string; created_at: string; metadata: Record<string, unknown> | null }[]) {
        const cid = m.metadata?.contact_id as string | undefined;
        if (!cid || !byContact.has(cid)) continue;
        const cur = state.get(cid) ?? { hasInbound: false, lastOutbound: 0 };
        if (m.direction === 'inbound') cur.hasInbound = true;
        if (m.direction === 'outbound') cur.lastOutbound = Math.max(cur.lastOutbound, Date.parse(m.created_at));
        state.set(cid, cur);
    }

    // 4. Skapa follow-up för de som skickats till men inte svarat, äldre än cutoff
    let created = 0;
    for (const [cid, oppId] of byContact) {
        const s = state.get(cid);
        if (!s || s.hasInbound || s.lastOutbound === 0 || s.lastOutbound > cutoff) continue;
        const { data: c } = await supabase.from('contacts').select('name').eq('id', cid).maybeSingle();
        const before = created;
        try {
            const { error } = await supabase.from('todos').insert(toRow({
                title: `Följ upp igen: ${c?.name ?? 'kontakt'}`,
                notes: `Öppnare skickad, inget svar på ${days}+ dagar.`,
                priority: 'normal',
                contactId: cid,
                opportunityId: oppId,
                autoKey: `followup:${cid}`,
            }, 'auto'));
            if (!error) created += 1;
            else if (error.code !== '23505') logger.warn('todos', `followup misslyckades: ${error.message}`);
        } catch (err) {
            logger.warn('todos', `followup undantag: ${err instanceof Error ? err.message : String(err)}`);
        }
        void before;
    }
    return { created };
}
