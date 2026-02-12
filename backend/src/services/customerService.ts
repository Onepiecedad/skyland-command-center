import { supabase } from './supabase';
import { logger } from './logger';
import { CustomerInfo } from '../llm/systemPrompt';

/**
 * Load customers for system prompt injection
 */
export async function loadCustomersForPrompt(): Promise<CustomerInfo[]> {
    const { data, error } = await supabase
        .from('customers')
        .select('id, name, slug');

    if (error || !data) {
        logger.error('customer', 'Error loading customers for prompt', { error: error?.message });
        return [];
    }

    return data;
}
