// ============================================================================
// API Base — Shared fetch wrapper with auth
// ============================================================================
import { API_BASE, SCC_API_TOKEN } from '../config';

export { API_BASE };

/**
 * Wrapper around fetch that injects Bearer token auth header.
 * Used for all SCC backend API calls.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (SCC_API_TOKEN) {
        headers.set('Authorization', `Bearer ${SCC_API_TOKEN}`);
    }
    return fetch(url, { ...options, headers });
}
