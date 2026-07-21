import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, Link2, Trash2, FileText, Film, Image as ImageIcon, Table2, Layout } from 'lucide-react';
import {
    fetchStudioAssets, getStudioAssetUrl, deleteStudioAsset, uploadStudioAsset,
    type StudioAsset, type StudioAssetKind,
} from '../api';

interface MaterialPanelProps {
    contactId: string;
}

const KIND_LABEL: Record<StudioAssetKind, string> = {
    landing: 'Landningssida', ad: 'Annons', carousel: 'Karusell', video: 'Video',
    poster: 'Poster', sheet: 'Ark', 'one-pager': 'One-pager', 'internal-brief': 'Internt underlag', other: 'Övrigt',
};
const KIND_ORDER: StudioAssetKind[] = ['landing', 'video', 'ad', 'carousel', 'poster', 'one-pager', 'sheet', 'internal-brief', 'other'];
const UPLOAD_KINDS: StudioAssetKind[] = KIND_ORDER;

function fmtSize(n: number | null): string {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function KindIcon({ kind, mime }: { kind: StudioAssetKind; mime: string | null }) {
    if (mime?.startsWith('video')) return <Film size={14} />;
    if (mime?.startsWith('image')) return <ImageIcon size={14} />;
    if (kind === 'sheet') return <Table2 size={14} />;
    if (kind === 'landing' || kind === 'one-pager') return <Layout size={14} />;
    return <FileText size={14} />;
}

const iconBtn: React.CSSProperties = { background: 'none', border: '1px solid #2c2c2c', color: '#9c968a', cursor: 'pointer', padding: '3px 7px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 };

export default function MaterialPanel({ contactId }: MaterialPanelProps) {
    const [assets, setAssets] = useState<StudioAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [upKind, setUpKind] = useState<StudioAssetKind>('ad');
    const [upAudience, setUpAudience] = useState<'internal' | 'client'>('client');
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            setAssets(await fetchStudioAssets(contactId));
        } catch (err) {
            setMsg('Kunde inte ladda material: ' + (err instanceof Error ? err.message : 'fel'));
        }
        setLoading(false);
    }, [contactId]);

    useEffect(() => { setLoading(true); void load(); }, [load]);

    const onPick = useCallback(async (file: File | undefined) => {
        if (!file) return;
        setBusy(true); setMsg(null);
        try {
            const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
            await uploadStudioAsset({ contactId, file, kind: upKind, audience: upAudience, title });
            await load();
            setMsg(`Uppladdat: ${title}`);
        } catch (err) {
            setMsg('Uppladdning misslyckades: ' + (err instanceof Error ? err.message : 'fel'));
        }
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
    }, [contactId, upKind, upAudience, load]);

    const openAsset = useCallback(async (a: StudioAsset) => {
        if (!a.url) return;
        const isHtml = /\.html?$/i.test(a.storage_path) || (a.mime?.includes('html') ?? false) || a.kind === 'landing' || a.kind === 'one-pager';
        if (!isHtml) { window.open(a.url, '_blank'); return; }
        // Supabase serverar HTML som text/plain (säkerhet). Hämta och öppna som
        // en text/html-blob så sidan renderas och åäö blir rätt.
        try {
            const res = await fetch(a.url);
            const buf = await res.arrayBuffer();
            window.open(URL.createObjectURL(new Blob([buf], { type: 'text/html;charset=utf-8' })), '_blank');
        } catch {
            window.open(a.url, '_blank');
        }
    }, []);

    const copyLink = useCallback(async (id: string) => {
        try {
            const url = await getStudioAssetUrl(id, 604800); // 7 dygn för kunddelning
            await navigator.clipboard.writeText(url);
            setMsg('Delningslänk kopierad (giltig 7 dygn)');
        } catch {
            setMsg('Kunde inte skapa länk');
        }
    }, []);

    const remove = useCallback(async (a: StudioAsset) => {
        if (!confirm(`Ta bort "${a.title}"?`)) return;
        setAssets(prev => prev.filter(x => x.id !== a.id));
        try { await deleteStudioAsset(a.id); } catch { void load(); }
    }, [load]);

    const groups = useMemo(() => {
        const by = (aud: 'client' | 'internal') =>
            assets.filter(a => a.audience === aud)
                .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
        return { client: by('client'), internal: by('internal') };
    }, [assets]);

    const renderAsset = (a: StudioAsset) => {
        const isImg = a.mime?.startsWith('image');
        const isVid = a.mime?.startsWith('video');
        return (
            <div key={a.id} style={{ border: '1px solid #222', borderRadius: 8, padding: 10, background: 'rgba(255,255,255,0.01)', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (isImg || isVid) ? 8 : 0 }}>
                    <span style={{ color: '#7f8a7f', display: 'flex' }}><KindIcon kind={a.kind} mime={a.mime} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#e8e4d8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                        <div style={{ fontSize: 10, color: '#9c968a' }}>{KIND_LABEL[a.kind]}{a.file_size ? ` · ${fmtSize(a.file_size)}` : ''}{a.version > 1 ? ` · v${a.version}` : ''}</div>
                    </div>
                </div>
                {isImg && a.url && <img src={a.url} alt={a.title} style={{ width: '100%', borderRadius: 6, maxHeight: 160, objectFit: 'cover' }} />}
                {isVid && a.url && <video src={a.url} controls preload="metadata" style={{ width: '100%', borderRadius: 6, maxHeight: 200 }} />}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    {a.url && <button onClick={() => void openAsset(a)} style={iconBtn}><Download size={12} /> Öppna</button>}
                    <button onClick={() => void copyLink(a.id)} style={iconBtn} title="Kopiera delningslänk (7 dygn)"><Link2 size={12} /> Länk</button>
                    <button onClick={() => void remove(a)} style={{ ...iconBtn, marginLeft: 'auto', color: '#c56b6b' }} title="Ta bort"><Trash2 size={12} /></button>
                </div>
            </div>
        );
    };

    return (
        <div style={{ color: '#e8e4d8', fontSize: 14 }}>
            {/* Uppladdning */}
            <div style={{ border: '1px solid #2c2c2c', borderRadius: 8, padding: 10, marginBottom: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={upKind} onChange={e => setUpKind(e.target.value as StudioAssetKind)} style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', borderRadius: 5, padding: '5px 6px', fontSize: 12 }}>
                    {UPLOAD_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <select value={upAudience} onChange={e => setUpAudience(e.target.value as 'internal' | 'client')} style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid #2c2c2c', color: '#e8e4d8', borderRadius: 5, padding: '5px 6px', fontSize: 12 }}>
                    <option value="client">Kund</option>
                    <option value="internal">Internt</option>
                </select>
                <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...iconBtn, marginLeft: 'auto', color: '#e8e4d8', borderColor: '#3a3a3a' }}>
                    <Upload size={13} /> {busy ? 'Laddar…' : 'Ladda upp'}
                </button>
                <input ref={fileRef} type="file" hidden onChange={e => void onPick(e.target.files?.[0])} />
            </div>

            {msg && <div style={{ fontSize: 12, color: '#9c968a', marginBottom: 10 }}>{msg}</div>}

            {loading ? <p style={{ opacity: 0.5, fontSize: 13 }}>Laddar…</p>
                : assets.length === 0 ? <p style={{ opacity: 0.5, fontSize: 13 }}>Inget material än. Ladda upp studions landningssida, annonser, video…</p>
                    : (
                        <>
                            {groups.client.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#7f8a7f', marginBottom: 8 }}>Kundvänt <span style={{ opacity: 0.6 }}>· {groups.client.length}</span></div>
                                    {groups.client.map(renderAsset)}
                                </div>
                            )}
                            {groups.internal.length > 0 && (
                                <div>
                                    <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#8a7f7f', marginBottom: 8 }}>Internt <span style={{ opacity: 0.6 }}>· {groups.internal.length}</span></div>
                                    {groups.internal.map(renderAsset)}
                                </div>
                            )}
                        </>
                    )}
        </div>
    );
}
