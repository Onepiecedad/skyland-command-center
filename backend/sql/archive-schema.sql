-- Alex Arkiv — Supabase Schema
-- Run this in Supabase SQL Editor

-- ============================================================================
-- Files table — metadata for all archived files
-- ============================================================================
CREATE TABLE IF NOT EXISTS archive_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    original_name TEXT,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,           -- 'dokument', 'bilder', 'video', 'rapporter', 'referenser'
    mime_type TEXT,
    file_size BIGINT,
    
    -- Metadata
    title TEXT,
    description TEXT,
    tags TEXT[] DEFAULT '{}',
    source TEXT,                        -- Where it came from (email, whatsapp, manual)
    project_id TEXT,                    -- Optional link to project
    customer_id UUID,                   -- Optional link to customer
    
    -- Dates
    file_date DATE,                     -- Date of the content (not upload date)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Search
    search_vector TSVECTOR,             -- Fulltext search
    
    -- Embeddings for semantic search (optional)
    embedding VECTOR(1536),             -- OpenAI embedding dimension
    
    -- Status
    is_archived BOOLEAN DEFAULT false,
    is_favorite BOOLEAN DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_archive_files_type ON archive_files(file_type);
CREATE INDEX IF NOT EXISTS idx_archive_files_tags ON archive_files USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_archive_files_search ON archive_files USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_archive_files_created ON archive_files(created_at DESC);

-- ============================================================================
-- Archive collections — group related files
-- ============================================================================
CREATE TABLE IF NOT EXISTS archive_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#6366f1',
    icon TEXT DEFAULT 'folder',
    parent_id UUID REFERENCES archive_collections(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link files to collections
CREATE TABLE IF NOT EXISTS archive_collection_files (
    collection_id UUID REFERENCES archive_collections(id) ON DELETE CASCADE,
    file_id UUID REFERENCES archive_files(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (collection_id, file_id)
);

-- ============================================================================
-- Fulltext search trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION update_archive_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('swedish', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('swedish', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('swedish', COALESCE(NEW.filename, '')), 'C') ||
        setweight(to_tsvector('swedish', array_to_string(NEW.tags, ' ')), 'D');
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER archive_files_search_trigger
    BEFORE INSERT OR UPDATE ON archive_files
    FOR EACH ROW EXECUTE FUNCTION update_archive_search_vector();

-- ============================================================================
-- Views
-- ============================================================================
CREATE OR REPLACE VIEW archive_stats AS
SELECT 
    file_type,
    COUNT(*) as file_count,
    SUM(file_size) as total_size,
    COUNT(CASE WHEN is_favorite THEN 1 END) as favorite_count
FROM archive_files
WHERE NOT is_archived
GROUP BY file_type;

-- ============================================================================
-- Sample collections
-- ============================================================================
INSERT INTO archive_collections (name, description, color, icon) VALUES
    ('Skyland Projekt', 'Dokument relaterade till Skyland AI', '#6366f1', 'rocket'),
    ('Kundprojekt', 'Kundrelaterade dokument', '#10b981', 'users'),
    ('Forskning', 'Research och analyser', '#f59e0b', 'flask-conical'),
    ('Personligt', 'Personliga filer', '#ec4899', 'heart')
ON CONFLICT DO NOTHING;
