import { useEffect, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

// ─── Types mirror backend /api/v1/deliverables ───
interface DeliverableEntry {
  id: string;
  type: string;
  entity?: { kind?: string; name?: string; org_nr?: string | null; slug?: string };
  date?: string;
  status?: string;
  score?: number | null;
  gate_pass?: boolean | null;
  title?: string;
  summary?: string;
  tags?: string[];
  paths?: { report?: string | null };
}

interface Facets {
  statuses: string[];
  types: string[];
  tags: string[];
}

const STATUS_COLOR: Record<string, string> = {
  qualified: '#22c55e',
  delivered: '#3b82f6',
  blocked: '#f59e0b',
  error: '#ef4444',
  saved: '#64748b',
};

function statusColor(s?: string): string {
  return STATUS_COLOR[(s || '').toLowerCase()] || '#64748b';
}

function fmtDate(d?: string): string {
  if (!d) return '';
  return d.slice(0, 10);
}

export default function ArchiveView() {
  const [entries, setEntries] = useState<DeliverableEntry[]>([]);
  const [facets, setFacets] = useState<Facets>({ statuses: [], types: [], tags: [] });
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const toggleCheck = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const deleteChecked = useCallback(async () => {
    if (checked.size === 0 || deleting) return;
    const ids = [...checked];
    console.log('[archive] raderar', ids);
    setDeleting(true);
    setDelErr(null);
    // Optimistic: remove from the UI immediately.
    setEntries((prev) => prev.filter((e) => !checked.has(e.id)));
    if (selectedId && checked.has(selectedId)) {
      setSelectedId(null);
      setReport(null);
      setArtifacts([]);
    }
    setChecked(new Set());
    let failed = 0;
    try {
      for (const id of ids) {
        try {
          const r = await fetch(`/api/v1/deliverables/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!r.ok) failed++;
        } catch {
          failed++;
        }
      }
    } finally {
      setDeleting(false);
    }
    if (failed > 0) {
      // backend rejected — resync truth and tell the user.
      setDelErr(`${failed} kunde inte raderas på servern — starta om backend (npm run dev i backend/).`);
      await load();
    }
  }, [checked, selectedId, deleting]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      const res = await fetch(`/api/v1/deliverables?${params.toString()}`);
      const data = await res.json();
      setEntries(data.entries || []);
      if (data.facets) setFacets(data.facets);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openEntry = useCallback(async (id: string) => {
    setSelectedId(id);
    setReport(null);
    setArtifacts([]);
    try {
      const res = await fetch(`/api/v1/deliverables/${encodeURIComponent(id)}`);
      const data = await res.json();
      setReport(data.report || '*Ingen rapport sparad för denna post.*');
      setArtifacts(data.artifacts || []);
    } catch {
      setReport('*Kunde inte läsa rapporten.*');
    }
  }, []);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId),
    [entries, selectedId],
  );

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      {/* ─── Left: list + filters ─── */}
      <div style={{ width: 380, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök företag, person, tagg…"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
              color: 'inherit', fontSize: 14, outline: 'none',
            }}
          />
        </div>

        {/* status filter chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <Chip label="Alla" active={!statusFilter} onClick={() => setStatusFilter('')} />
          {facets.statuses.map((s) => (
            <Chip key={s} label={s} active={statusFilter === s} color={statusColor(s)}
                  onClick={() => setStatusFilter(statusFilter === s ? '' : s)} />
          ))}
        </div>
        {facets.types.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <Chip label="Alla typer" active={!typeFilter} onClick={() => setTypeFilter('')} />
            {facets.types.map((t) => (
              <Chip key={t} label={t} active={typeFilter === t}
                    onClick={() => setTypeFilter(typeFilter === t ? '' : t)} />
            ))}
          </div>
        )}

        {checked.size > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            marginBottom: 10, padding: '8px 12px', borderRadius: 10,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13 }}>{checked.size} markerad(e)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setChecked(new Set())}
                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'inherit' }}>
                  Avmarkera
                </button>
                <button
                  onClick={deleteChecked}
                  disabled={deleting}
                  style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                    border: '1px solid rgba(239,68,68,0.6)', background: '#ef4444', color: '#fff' }}>
                  {deleting ? 'Raderar…' : `Radera (${checked.size})`}
                </button>
              </div>
            </div>
            {delErr && <div style={{ fontSize: 12, color: '#fca5a5' }}>{delErr}</div>}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ opacity: 0.6, fontSize: 13 }}>Laddar…</div>}
          {!loading && entries.length === 0 && (
            <div style={{ opacity: 0.6, fontSize: 13, padding: 12 }}>
              Inga leverabler ännu. När pipelinen eller Alex producerar något hamnar det här.
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
              <input
                type="checkbox"
                checked={checked.has(e.id)}
                onChange={() => toggleCheck(e.id)}
                title="Markera för radering"
                style={{ marginTop: 12, flexShrink: 0, cursor: 'pointer', accentColor: '#ef4444' }}
              />
              <button
                onClick={() => openEntry(e.id)}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  border: selectedId === e.id ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  background: checked.has(e.id) ? 'rgba(239,68,68,0.08)'
                    : selectedId === e.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(e.status), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title || e.entity?.name || e.id}
                  </span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                  {fmtDate(e.date)} · {e.type}
                  {e.score != null && <> · score {e.score}</>}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.summary}
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Right: report detail ─── */}
      <div style={{
        flex: 1, minWidth: 0, overflowY: 'auto', padding: 24, borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)',
      }}>
        {!selected && (
          <div style={{ opacity: 0.5, fontSize: 14, marginTop: 40, textAlign: 'center' }}>
            Välj en leverabel till vänster för att läsa rapporten.
          </div>
        )}
        {selected && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor(selected.status) }} />
              <span style={{ fontSize: 13, opacity: 0.7 }}>
                {selected.status} · {selected.type} · {fmtDate(selected.date)}
                {selected.entity?.org_nr ? ` · org.nr ${selected.entity.org_nr}` : ''}
              </span>
            </div>
            {selected.tags && selected.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 16px' }}>
                {selected.tags.map((t) => <Chip key={t} label={t} small />)}
              </div>
            )}
            <div className="archive-report-md" style={{ lineHeight: 1.6 }}>
              <ReactMarkdown>{report || 'Laddar…'}</ReactMarkdown>
            </div>
            {artifacts.length > 0 && (
              <details style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <summary style={{ fontSize: 11, opacity: 0.4, cursor: 'pointer', userSelect: 'none' }}>
                  Råfiler ({artifacts.length}) — för felsökning
                </summary>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {artifacts.map((a) => (
                    <a
                      key={a}
                      href={`/api/v1/deliverables/${encodeURIComponent(selected.id)}/raw/${encodeURIComponent(a)}`}
                      target="_blank" rel="noreferrer"
                      style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 8, opacity: 0.6,
                        border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none', color: 'inherit',
                      }}
                    >{a}</a>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>

      <style>{`
        .archive-report-md h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
        .archive-report-md h2 {
          font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
          opacity: .6; margin: 22px 0 8px; font-weight: 600;
        }
        .archive-report-md h3 { font-size: 15px; font-weight: 600; margin: 16px 0 6px; }
        .archive-report-md ul { margin: 4px 0 4px; padding-left: 18px; }
        .archive-report-md li { margin: 3px 0; }
        .archive-report-md p { margin: 8px 0; }
        .archive-report-md strong { font-weight: 600; }
        .archive-report-md blockquote {
          margin: 8px 0; padding: 6px 14px; border-left: 3px solid rgba(255,255,255,0.2);
          opacity: .8; font-style: italic;
        }
        .archive-report-md hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0; }
        .archive-report-md code {
          background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-size: 12px;
        }
        .archive-report-md table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
        .archive-report-md th, .archive-report-md td {
          border: 1px solid rgba(255,255,255,0.12); padding: 4px 10px; text-align: left;
        }
      `}</style>
    </div>
  );
}

interface ChipProps {
  label: string;
  active?: boolean;
  color?: string;
  small?: boolean;
  onClick?: () => void;
}

function Chip({ label, active, color, small, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: small ? 11 : 12,
        padding: small ? '2px 8px' : '4px 10px',
        borderRadius: 999,
        cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${active ? (color || 'rgba(255,255,255,0.4)') : 'rgba(255,255,255,0.12)'}`,
        background: active ? (color ? `${color}22` : 'rgba(255,255,255,0.1)') : 'transparent',
        color: 'inherit',
        textTransform: 'capitalize',
      }}
    >
      {color && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 5 }} />}
      {label}
    </button>
  );
}
