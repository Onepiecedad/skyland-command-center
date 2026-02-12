import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../services/supabase';

const router = Router();

// ============================================================================
// Configuration
// ============================================================================
const ARCHIVE_BASE = process.env.ARCHIVE_PATH || path.join(process.env.HOME || '', 'Arkiv');
const ALLOWED_TYPES = ['dokument', 'bilder', 'video', 'rapporter', 'referenser'] as const;

// ============================================================================
// Types
// ============================================================================
export interface ArchiveFile {
    id: string;
    filename: string;
    original_name?: string;
    file_path: string;
    file_type: string;
    mime_type?: string;
    file_size?: number;
    title?: string;
    description?: string;
    tags: string[];
    source?: string;
    project_id?: string;
    customer_id?: string;
    file_date?: string;
    created_at: string;
    updated_at: string;
    is_archived: boolean;
    is_favorite: boolean;
}

// ============================================================================
// Helpers
// ============================================================================
function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
}

function detectMimeType(filename: string): string {
    const ext = getFileExtension(filename);
    const mimeTypes: Record<string, string> = {
        // Documents
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain',
        'md': 'text/markdown',
        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'heic': 'image/heic',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        // Video
        'mp4': 'video/mp4',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',
        // Audio
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'm4a': 'audio/mp4',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

function detectFileType(filename: string): string {
    const ext = getFileExtension(filename);

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg'];
    const videoExts = ['mp4', 'mov', 'avi', 'mkv'];
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'];

    if (imageExts.includes(ext)) return 'bilder';
    if (videoExts.includes(ext)) return 'video';
    if (docExts.includes(ext)) return 'dokument';

    return 'referenser';
}

async function ensureDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ============================================================================
// GET /files — List files with filters
// ============================================================================
const listSchema = z.object({
    type: z.enum(ALLOWED_TYPES).optional(),
    tags: z.string().optional(),
    search: z.string().optional(),
    favorite: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

router.get('/files', async (req: Request, res: Response) => {
    try {
        const parsed = listSchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
        }

        const { type, tags, search, favorite, limit, offset } = parsed.data;

        let query = supabase
            .from('archive_files')
            .select('*', { count: 'exact' })
            .eq('is_archived', false)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (type) {
            query = query.eq('file_type', type);
        }

        if (tags) {
            query = query.contains('tags', tags.split(','));
        }

        if (favorite !== undefined) {
            query = query.eq('is_favorite', favorite);
        }

        if (search) {
            query = query.textSearch('search_vector', search, { type: 'websearch' });
        }

        const { data, error, count } = await query;

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        return res.json({
            files: data,
            total: count,
            limit,
            offset,
        });
    } catch (err) {
        console.error('List files error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /files/:id — Get single file
// ============================================================================
router.get('/files/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('archive_files')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check if file exists on disk
        const fullPath = path.join(ARCHIVE_BASE, data.file_path);
        const exists = fs.existsSync(fullPath);

        return res.json({
            ...data,
            exists_on_disk: exists,
            full_path: exists ? fullPath : null,
        });
    } catch (err) {
        console.error('Get file error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /files — Add file to archive
// ============================================================================
const addSchema = z.object({
    filename: z.string().min(1),
    original_name: z.string().optional(),
    file_type: z.enum(ALLOWED_TYPES).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    source: z.string().optional(),
    project_id: z.string().optional(),
    customer_id: z.string().uuid().optional(),
    file_date: z.string().optional(),
    file_size: z.number().optional(),
    // Optional: base64 content for upload
    content: z.string().optional(),
});

router.post('/files', async (req: Request, res: Response) => {
    try {
        const parsed = addSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
        }

        const {
            filename,
            original_name,
            file_type,
            title,
            description,
            tags,
            source,
            project_id,
            customer_id,
            file_date,
            file_size,
            content
        } = parsed.data;

        // Detect file type if not provided
        const detectedType = file_type || detectFileType(filename);
        const mimeType = detectMimeType(filename);

        // Build file path
        const filePath = `${detectedType}/${filename}`;
        const fullPath = path.join(ARCHIVE_BASE, filePath);

        // Ensure directory exists
        await ensureDir(path.dirname(fullPath));

        // Write content if provided
        if (content) {
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(fullPath, buffer);
        }

        // Get file size if not provided
        const stats = content ? null : fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
        const size = file_size || stats?.size;

        // Insert into database
        const { data, error } = await supabase
            .from('archive_files')
            .insert({
                filename,
                original_name: original_name || filename,
                file_path: filePath,
                file_type: detectedType,
                mime_type: mimeType,
                file_size: size,
                title: title || original_name || filename,
                description,
                tags,
                source,
                project_id,
                customer_id,
                file_date,
            })
            .select()
            .single();

        if (error) {
            console.error('Insert error:', error);
            return res.status(500).json({ error: 'Failed to add file' });
        }

        return res.json({ success: true, file: data });
    } catch (err) {
        console.error('Add file error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PATCH /files/:id — Update file metadata
// ============================================================================
const updateSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    is_favorite: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    project_id: z.string().optional(),
    customer_id: z.string().uuid().optional(),
    file_date: z.string().optional(),
});

router.patch('/files/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const parsed = updateSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
        }

        const { data, error } = await supabase
            .from('archive_files')
            .update(parsed.data)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: 'Failed to update file' });
        }

        return res.json({ success: true, file: data });
    } catch (err) {
        console.error('Update file error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /files/:id — Remove file from archive
// ============================================================================
router.delete('/files/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { delete_file } = req.query;

        // Get file info first
        const { data: file, error: fetchError } = await supabase
            .from('archive_files')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete from database
        const { error: deleteError } = await supabase
            .from('archive_files')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: 'Failed to delete from database' });
        }

        // Optionally delete from disk
        if (delete_file === 'true') {
            const fullPath = path.join(ARCHIVE_BASE, file.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        return res.json({ success: true, deleted_from_disk: delete_file === 'true' });
    } catch (err) {
        console.error('Delete file error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /scan — Scan local archive folder and sync
// ============================================================================
router.get('/scan', async (_req: Request, res: Response) => {
    try {
        const stats = {
            scanned: 0,
            added: 0,
            skipped: 0,
            errors: [] as string[],
        };

        // Get existing files from database
        const { data: existingFiles } = await supabase
            .from('archive_files')
            .select('file_path');

        const existingPaths = new Set(existingFiles?.map(f => f.file_path) || []);

        // Scan each type folder
        for (const type of ALLOWED_TYPES) {
            const typeDir = path.join(ARCHIVE_BASE, type);

            if (!fs.existsSync(typeDir)) {
                continue;
            }

            const files = fs.readdirSync(typeDir);

            for (const filename of files) {
                stats.scanned++;
                const filePath = `${type}/${filename}`;

                // Skip if already in database
                if (existingPaths.has(filePath)) {
                    stats.skipped++;
                    continue;
                }

                try {
                    const fullPath = path.join(typeDir, filename);
                    const fileStats = fs.statSync(fullPath);

                    // Skip directories
                    if (fileStats.isDirectory()) {
                        continue;
                    }

                    // Add to database
                    const { error } = await supabase
                        .from('archive_files')
                        .insert({
                            filename,
                            file_path: filePath,
                            file_type: type,
                            mime_type: detectMimeType(filename),
                            file_size: fileStats.size,
                            title: filename,
                            source: 'scan',
                        });

                    if (error) {
                        stats.errors.push(`${filename}: ${error.message}`);
                    } else {
                        stats.added++;
                    }
                } catch (err) {
                    stats.errors.push(`${filename}: ${String(err)}`);
                }
            }
        }

        return res.json(stats);
    } catch (err) {
        console.error('Scan error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /stats — Archive statistics
// ============================================================================
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        // Get stats from view
        const { data: typeStats } = await supabase
            .from('archive_files')
            .select('file_type, file_size, is_favorite')
            .eq('is_archived', false);

        // Aggregate
        const stats: Record<string, { count: number; size: number; favorites: number }> = {};
        let totalSize = 0;
        let totalCount = 0;

        for (const file of typeStats || []) {
            const type = file.file_type;
            if (!stats[type]) {
                stats[type] = { count: 0, size: 0, favorites: 0 };
            }
            stats[type].count++;
            stats[type].size += file.file_size || 0;
            if (file.is_favorite) stats[type].favorites++;
            totalSize += file.file_size || 0;
            totalCount++;
        }

        // Format sizes
        const formatSize = (bytes: number): string => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        };

        return res.json({
            by_type: stats,
            total: {
                count: totalCount,
                size: totalSize,
                size_formatted: formatSize(totalSize),
            },
        });
    } catch (err) {
        console.error('Stats error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /collections — List collections
// ============================================================================
router.get('/collections', async (_req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('archive_collections')
            .select('*')
            .order('name');

        if (error) {
            return res.status(500).json({ error: 'Database error' });
        }

        return res.json({ collections: data });
    } catch (err) {
        console.error('Collections error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
