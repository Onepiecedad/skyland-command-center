CREATE TABLE IF NOT EXISTS archive_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    original_name TEXT,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'dokument' CHECK (file_type IN ('dokument', 'bilder', 'video', 'rapporter', 'referenser')),
    mime_type TEXT,
    file_size BIGINT,
    title TEXT,
    description TEXT,
    tags TEXT[] DEFAULT '{}',
    source TEXT,
    project_id TEXT,
    customer_id UUID REFERENCES customers(id),
    file_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_archived BOOLEAN DEFAULT FALSE,
    is_favorite BOOLEAN DEFAULT FALSE,
    search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_archive_files_type ON archive_files(file_type);
CREATE INDEX IF NOT EXISTS idx_archive_files_favorite ON archive_files(is_favorite);
CREATE INDEX IF NOT EXISTS idx_archive_files_archived ON archive_files(is_archived);
CREATE INDEX IF NOT EXISTS idx_archive_files_customer ON archive_files(customer_id);
CREATE INDEX IF NOT EXISTS idx_archive_files_search ON archive_files USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_archive_files_created ON archive_files(created_at DESC);

CREATE OR REPLACE FUNCTION archive_files_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('swedish',
        COALESCE(NEW.title, '') || ' ' ||
        COALESCE(NEW.description, '') || ' ' ||
        COALESCE(NEW.filename, '') || ' ' ||
        COALESCE(array_to_string(NEW.tags, ' '), '')
    );
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_archive_search ON archive_files;
CREATE TRIGGER trg_archive_search
    BEFORE INSERT OR UPDATE ON archive_files
    FOR EACH ROW
    EXECUTE FUNCTION archive_files_search_trigger();

ALTER TABLE archive_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY archive_files_service_all ON archive_files
    FOR ALL
    USING (true)
    WITH CHECK (true);
