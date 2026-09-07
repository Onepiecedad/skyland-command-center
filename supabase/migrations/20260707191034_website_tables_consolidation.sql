-- =============================================================================
-- Konsolidering: hemsidans (skylandai.se) tabeller in i SCC-projektet
-- Källa: stitch_skyland_ai_operating_system/supabase/migrations/*
--        + voice_calls rekonstruerad från n8n voice-call-ended workflow
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sessions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid    uuid        UNIQUE NOT NULL,
    created_at      timestamptz DEFAULT now(),
    last_active_at  timestamptz DEFAULT now(),
    user_agent      text,
    entry_module    text,
    metadata        jsonb       DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS interactions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid    uuid        NOT NULL
                                REFERENCES sessions(session_uuid) ON DELETE CASCADE,
    type            text        NOT NULL
                                CHECK (type IN ('voice', 'form', 'view')),
    payload         jsonb       DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prospects (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid    uuid        NOT NULL
                                REFERENCES sessions(session_uuid) ON DELETE CASCADE,
    customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
    name            text,
    email           text,
    company         text,
    website         text,
    phone           text,
    message         text,
    score           integer     DEFAULT 0,
    consent_given   boolean     DEFAULT false,
    retention_until timestamptz DEFAULT now() + interval '30 days',
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_base (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text        NOT NULL,
    content         text        NOT NULL,
    category        text        CHECK (category IN ('service', 'faq', 'case_study', 'tech')),
    embedding       vector(1536),
    metadata        jsonb       DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_calls (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid     uuid        REFERENCES sessions(session_uuid) ON DELETE SET NULL,
    prospect_id      uuid        REFERENCES prospects(id) ON DELETE SET NULL,
    customer_id      uuid        REFERENCES customers(id) ON DELETE SET NULL,
    provider         text        NOT NULL DEFAULT 'elevenlabs',
    external_call_id text        NOT NULL,
    call_source      text,
    agent_id         text,
    started_at       timestamptz,
    ended_at         timestamptz,
    duration_seconds integer,
    transcript       text,
    summary          text,
    recording_url    text,
    extracted_data   jsonb       DEFAULT '{}'::jsonb,
    metadata         jsonb       DEFAULT '{}'::jsonb,
    raw_payload      jsonb       DEFAULT '{}'::jsonb,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    CONSTRAINT voice_calls_provider_external_unique UNIQUE (provider, external_call_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_uuid ON sessions (session_uuid);
CREATE INDEX IF NOT EXISTS idx_interactions_session_uuid ON interactions (session_uuid);
CREATE INDEX IF NOT EXISTS idx_prospects_session_uuid ON prospects (session_uuid);
CREATE INDEX IF NOT EXISTS idx_prospects_customer ON prospects (customer_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_session ON voice_calls (session_uuid);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding ON knowledge_base
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE knowledge_base ADD CONSTRAINT knowledge_base_title_unique UNIQUE (title);

CREATE OR REPLACE FUNCTION match_knowledge_base(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id uuid, title text, content text, category text, metadata jsonb, similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT kb.id, kb.title, kb.content, kb.category, kb.metadata,
           1 - (kb.embedding <=> query_embedding) AS similarity
    FROM knowledge_base kb
    WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold
    ORDER BY kb.embedding <=> query_embedding
    LIMIT match_count;
$$;

ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_sessions" ON sessions FOR ALL TO anon USING (false);
CREATE POLICY "deny_all_anon_interactions" ON interactions FOR ALL TO anon USING (false);
CREATE POLICY "deny_all_anon_prospects" ON prospects FOR ALL TO anon USING (false);
CREATE POLICY "deny_all_anon_knowledge_base" ON knowledge_base FOR ALL TO anon USING (false);
CREATE POLICY "deny_all_anon_voice_calls" ON voice_calls FOR ALL TO anon USING (false);
CREATE POLICY "deny_all_authenticated_sessions" ON sessions FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_all_authenticated_interactions" ON interactions FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_all_authenticated_prospects" ON prospects FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_all_authenticated_knowledge_base" ON knowledge_base FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_all_authenticated_voice_calls" ON voice_calls FOR ALL TO authenticated USING (false);;
