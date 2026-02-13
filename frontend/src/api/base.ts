// ============================================================================
// API Base — Shared fetch wrapper with auth + timeout
// ============================================================================
import { API_BASE, SCC_API_TOKEN } from '../config';

export { API_BASE };

/** Default timeout for API calls (15 seconds) */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Wrapper around fetch that injects Bearer token auth header
 * and applies a timeout via AbortController.
 * Used for all SCC backend API calls.
 */
export async function fetchWithAuth(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

    const headers = new Headers(fetchOptions.headers);
    if (SCC_API_TOKEN) {
        headers.set('Authorization', `Bearer ${SCC_API_TOKEN}`);
    }

    // Create an AbortController to enforce timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Merge caller's signal if any (both abort on either trigger)
    if (fetchOptions.signal) {
        fetchOptions.signal.addEventListener('abort', () => controller.abort());
    }

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            headers,
            signal: controller.signal,
        });
        return response;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error(`API request to ${url} timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
