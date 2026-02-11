import { supabase } from './supabase';
import { CustomerInfo } from '../llm/systemPrompt';

/**
 * Load customers for system prompt injection
 */
export async function loadCustomersForPrompt(): Promise<CustomerInfo[]> {
    const { data, error } = await supabase
        .from('customers')
        .select('id, name, slug');

    if (error || !data) {
        console.error('Error loading customers for prompt:', error);
        return [];
    }

    return data;
}
