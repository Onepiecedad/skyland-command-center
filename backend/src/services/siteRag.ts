/**
 * Kunskapsbas-sökning för sajten (SCC-48) — portad från n8n-flödet "rag_query".
 *
 * Embeddar frågan med OpenAI text-embedding-3-small och kör Supabase-RPC:n
 * match_knowledge_base (tröskel 0.35, topp 3). Under tröskeln → tom lista,
 * exakt som n8n-flödet gjorde. Fel i OpenAI/Supabase ger också tom lista:
 * void-svaret ska aldrig falla för att kunskapsbasen är nere.
 */
import { supabase, websiteSupabase } from './supabase';
import { config } from '../config';
import { logger } from './logger';

export const RAG_THRESHOLD = 0.35;
export const RAG_MATCH_COUNT = 3;

export interface RagMatch { title: string; content: string; category: string | null; similarity: number }
export interface RagResult { matches: RagMatch[]; query: string; best_similarity: number; fallback_reason?: string }

const db = () => websiteSupabase ?? supabase;

export async function embedQuery(text: string): Promise<number[] | null> {
    if (!config.OPENAI_API_KEY) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
        const r = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.OPENAI_API_KEY}` },
            body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
            signal: ctrl.signal,
        });
        if (!r.ok) { logger.warn('site.rag', `OpenAI embeddings ${r.status}`); return null; }
        const j = await r.json() as { data?: Array<{ embedding: number[] }> };
        return j.data?.[0]?.embedding ?? null;
    } catch (e) {
        logger.warn('site.rag', 'embedding failed', { error: String(e) });
        return null;
    } finally { clearTimeout(t); }
}

export async function ragQuery(query: string): Promise<RagResult> {
    const q = (query || '').trim();
    const empty = (reason: string): RagResult => ({ matches: [], query: q, best_similarity: 0, fallback_reason: reason });
    if (!q) return empty('empty query');

    const embedding = await embedQuery(q);
    if (!embedding) return empty('embedding unavailable');

    const { data, error } = await db().rpc('match_knowledge_base', {
        query_embedding: embedding, match_threshold: RAG_THRESHOLD, match_count: RAG_MATCH_COUNT,
    });
    if (error) { logger.warn('site.rag', 'match_knowledge_base failed', { error: error.message }); return empty('search failed'); }

    const chunks = (Array.isArray(data) ? data : []) as Array<{ title: string; content: string; category: string | null; similarity: number }>;
    const round = (n: number) => Math.round(n * 10000) / 10000;
    const best = chunks.length ? round(chunks[0].similarity) : 0;
    if (best < RAG_THRESHOLD) return empty('below threshold');

    const matches = chunks.slice(0, RAG_MATCH_COUNT).map(c => ({
        title: c.title, content: c.content, category: c.category, similarity: round(c.similarity),
    }));
    return { matches, query: q, best_similarity: matches[0]?.similarity || 0 };
}
