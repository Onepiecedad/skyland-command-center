import { supabase } from './supabase';
import { ChatMessage } from '../llm/adapter';

// Number of previous messages to include in context
const CHAT_CONTEXT_MESSAGE_LIMIT = 10;

/**
 * Log a message to the messages table
 */
export async function logMessage(params: {
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    channel: string;
    direction: 'internal' | 'inbound' | 'outbound';
    content: string;
    customer_id?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const { error } = await supabase
        .from('messages')
        .insert({
            conversation_id: params.conversation_id,
            role: params.role,
            channel: params.channel,
            direction: params.direction,
            content: params.content,
            customer_id: params.customer_id ?? null,
            metadata: params.metadata ?? {}
        });

    if (error) {
        console.error('Error logging message:', error);
    }
}

/**
 * Load recent messages for context
 */
export async function loadRecentMessages(
    conversationId: string | null,
    limit: number = CHAT_CONTEXT_MESSAGE_LIMIT
): Promise<ChatMessage[]> {
    let query = supabase
        .from('messages')
        .select('role, content, created_at')
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: false })
        .limit(limit);

    if (conversationId) {
        query = query.eq('conversation_id', conversationId);
    }

    const { data, error } = await query;

    if (error || !data) {
        return [];
    }

    // Reverse to get chronological order and map to ChatMessage format
    return data.reverse().map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
    }));
}
