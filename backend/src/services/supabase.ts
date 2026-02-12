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
