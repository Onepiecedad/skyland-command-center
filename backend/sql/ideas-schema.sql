-- Ideas table for SCC
-- Stores project ideas, concepts, and future plans

CREATE TABLE IF NOT EXISTS ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'new', -- new, in-progress, planned, completed, archived
    priority TEXT DEFAULT 'medium', -- low, medium, high, critical
    tags TEXT[] DEFAULT '{}',
    source TEXT, -- where the idea came from
    created_by TEXT DEFAULT 'system',
    assigned_to TEXT,
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    notes TEXT,
    attachments JSONB DEFAULT '[]'::jsonb
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority);
CREATE INDEX IF NOT EXISTS idx_ideas_tags ON ideas USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);

-- Sample ideas for AI-influencer project
INSERT INTO ideas (title, description, category, status, priority, tags, source, notes) VALUES
    (
        'Skapa AI-influencer kanal', 
        'Gemensam TikTok/Instagram-kanal om vibe-kodning och AI-agenter på svenska. Daglig genomgång av andras content för egen inspiration.',
        'content',
        'new',
        'high',
        ARRAY['ai', 'influencer', 'vibe-coding', 'swedish', 'social-media'],
        'user-request',
        'Inspiration: Professor Glitch (@pro.glitch). Målgrupp: AI-nyfikna som inte vet var de ska börja. Format: slides + animerade videos.'
    ),
    (
        'Content research dashboard',
        'Dashboard där AI kan samla dagliga spaningar från 10-15 utvalda konton för analys och inspiration.',
        'tool',
        'planned',
        'high',
        ARRAY['dashboard', 'research', 'automation', 'content'],
        'derived',
        'Behöver integrationer mot TikTok API, Instagram, YouTube för monitoring.'
    ),
    (
        'Godkännande-workflow för content',
        'System där AI skapar content-förslag → användare godkänner → automatisk publicering.',
        'workflow',
        'planned',
        'medium',
        ARRAY['workflow', 'approval', 'automation', 'content'],
        'derived',
        'Kan byggas med n8n eller liknande. Buffer/Schedule för cross-posting.'
    ),
    (
        'AI-avatar skapelse',
        'Generera konsekvent AI-avatar för video-innehåll. ElevenLabs för röst.',
        'content',
        'new',
        'medium',
        ARRAY['avatar', 'video', 'tts', 'elevenlabs'],
        'derived',
        'Lovart, Pika, Runway som möjliga tools för animering.'
    )
ON CONFLICT DO NOTHING;
