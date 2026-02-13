// ============================================================================
// Centralized URL Configuration — Skyland Command Center
// ============================================================================

const IS_LOCAL = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/** SCC backend REST base (with /api/v1 suffix) */
export const API_BASE =
    import.meta.env.VITE_API_BASE || (IS_LOCAL ? 'http://localhost:3001/api/v1' : '/api/v1');

/** SCC backend root (without /api/v1) — used by StatusBar, SystemResources etc. */
export const API_URL =
    import.meta.env.VITE_API_URL || (IS_LOCAL ? 'http://localhost:3001' : '');

/** OpenClaw gateway URL (HTTP) — only works locally */
export const GATEWAY_HTTP =
    import.meta.env.VITE_GATEWAY_HTTP || 'http://localhost:18789';

/** OpenClaw gateway URL (WebSocket) — only works locally */
export const GATEWAY_WS =
    import.meta.env.VITE_GATEWAY_URL || 'ws://127.0.0.1:18789';

/** SCC API bearer token */
export const SCC_API_TOKEN =
    import.meta.env.VITE_SCC_API_TOKEN || '';
