// ============================================================================
// Customer API
// ============================================================================
import { API_BASE, fetchWithAuth } from './base';
import type { Customer, Activity } from './types';

export async function fetchCustomers(slug?: string): Promise<Customer[]> {
    const url = slug
        ? `${API_BASE}/customers?slug=${encodeURIComponent(slug)}`
        : `${API_BASE}/customers`;
    const res = await fetchWithAuth(url);
    const data = await res.json();
    return data.customers || [];
}

export async function fetchActivities(params?: {
    limit?: number;
    offset?: number;
    customer_id?: string;
    event_type?: string;
    severity?: string;
    agent?: string;
}): Promise<Activity[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.customer_id) searchParams.set('customer_id', params.customer_id);
    if (params?.event_type) searchParams.set('event_type', params.event_type);
    if (params?.severity) searchParams.set('severity', params.severity);
    if (params?.agent) searchParams.set('agent', params.agent);

    const url = `${API_BASE}/activities?${searchParams}`;
    const res = await fetchWithAuth(url);
    const data = await res.json();
    return data.activities || [];
}

export async function fetchCustomerContext(slug: string): Promise<{
    customer: Customer & { errors_24h: number; warnings_24h: number; open_tasks: number; failed_tasks_24h: number; last_activity: string | null };
    context: {
        activities: Activity[];
        tasks: import('./types').Task[];
        related_agents: string[];
    };
}> {
    const res = await fetchWithAuth(`${API_BASE}/context/customer/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
