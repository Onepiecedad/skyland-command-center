import { supabase } from './supabase';
import { logger } from './logger';
import { CustomerInfo, PipelineInfo } from '../llm/systemPrompt';

/**
 * Kunder till systemprompten. Läser customer_status (inte customers) för att
 * få med site_tenant_slug — Alex ska veta VEM som har en spårad hemsida, annars
 * erbjuder han webbstatistik för kunder som inte har någon.
 */
export async function loadCustomersForPrompt(): Promise<CustomerInfo[]> {
    const { data, error } = await supabase
        .from('customer_status')
        .select('id, name, slug, status, site_tenant_slug');

    if (error || !data) {
        logger.error('customer', 'Error loading customers for prompt', { error: error?.message });
        return [];
    }

    return data as CustomerInfo[];
}

/**
 * Pipelines till systemprompten. Namnen ändras (Beauty tillkom i somras), och
 * en hårdkodad lista i prompten blir fel utan att någon märker det. Antal
 * hämtas aldrig här — siffror ska komma från get_crm_stats i stunden.
 */
export async function loadPipelinesForPrompt(): Promise<PipelineInfo[]> {
    const { data, error } = await supabase
        .from('pipelines')
        .select('name, is_default')
        .order('name');

    if (error || !data) {
        logger.warn('customer', `Kunde inte läsa pipelines: ${error?.message ?? 'okänt fel'}`);
        return [];
    }

    return data as PipelineInfo[];
}
