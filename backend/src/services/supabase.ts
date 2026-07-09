import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

// Create Supabase client with service role key (server-side only)
// Validation already handled by config.ts at startup
export const supabase: SupabaseClient = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

/**
 * Client for the WEBSITE Supabase project (skyland-ai-os.netlify.app).
 * Holds sessions, prospects, interactions and voice_calls written by the
 * n8n workflows. Used by the leads detail endpoint to fetch transcripts
 * and AI responses. Null if env vars are not configured.
 */
export const websiteSupabase: SupabaseClient | null =
    process.env.WEBSITE_SUPABASE_URL && process.env.WEBSITE_SUPABASE_SERVICE_KEY
        ? createClient(
            process.env.WEBSITE_SUPABASE_URL,
            process.env.WEBSITE_SUPABASE_SERVICE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            }
        )
        : null;
