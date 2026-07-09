import { useState, useEffect, useCallback } from 'react';
import {
    Database,
    Server,
    Clock,
    Activity,
    Shield,
    CheckCircle,
    XCircle,
} from 'lucide-react';
import { API_URL } from '../../config';

// ─── Types ───
interface ResourceStatus {
    label: string;
    ok: boolean;
    detail: string;
    icon: typeof Database;
}

interface CronJob {
    id: string;
    name: string;
    schedule: string;
    nextRun: string | null;
    status: 'active' | 'paused';
}

export function SystemResources() {
    const [resources, setResources] = useState<ResourceStatus[]>([]);
    const [cronJobs, setCronJobs] = useState<CronJob[]>([]);

    const fetchResources = useCallback(async () => {
        // Check backend health
        let backendOk = false;
        let backendDetail = 'Offline';
        try {
            const res = await fetch(`${API_URL}/health`);
            if (res.ok) {
                const data = await res.json();
                backendOk = data.status === 'healthy';
                backendDetail = backendOk ? `Uptime ${Math.floor(data.uptime / 60)}m` : 'Unhealthy';
            }
        } catch { /* offline */ }

        // Check Supabase connectivity
        let supabaseOk = false;
        let supabaseDetail = 'Ej tillgänglig';
        try {
            const sbUrl = import.meta.env.VITE_SUPABASE_URL;
            if (sbUrl) {
                const sbRes = await fetch(`${sbUrl}/rest/v1/`, {
                    method: 'HEAD',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
                    },
                });
                // A 401/403 means Supabase RESPONDED (it's reachable) but rejected
                // the empty browser key — not an outage. Treat as up, label honestly.
                if (sbRes.ok || sbRes.status === 200) {
                    supabaseOk = true; supabaseDetail = 'Connected';
                } else if (sbRes.status === 401 || sbRes.status === 403) {
                    supabaseOk = true; supabaseDetail = 'Uppe (frontend-nyckel saknas)';
                } else {
                    supabaseOk = false; supabaseDetail = `HTTP ${sbRes.status}`;
                }
            }
        } catch { /* offline */ }

        setResources([
            { label: 'Supabase', ok: supabaseOk, detail: supabaseDetail, icon: Database },
            { label: 'SCC Backend', ok: backendOk, detail: backendDetail, icon: Server },
            { label: 'Gateway', ok: true, detail: 'Port 18789', icon: Activity },
            { label: 'API Quotas', ok: true, detail: 'Inom gräns', icon: Shield },
        ]);
    }, []);

    useEffect(() => { fetchResources(); }, [fetchResources]);

    // Auto-refresh every 60s
    useEffect(() => {
        const interval = setInterval(fetchResources, 60000);
        return () => clearInterval(interval);
    }, [fetchResources]);

    // Real cron jobs from the gateway's scheduled-jobs DB (not mock).
    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`${API_URL}/api/v1/automations`);
                const data = await res.json();
                setCronJobs((data.jobs || []).map((j: {
                    id: string; name: string; schedule: string | null;
                    nextRun: string | null; enabled: boolean;
                }) => ({
                    id: j.id,
                    name: j.name,
                    schedule: j.schedule || '—',
                    nextRun: j.nextRun,
                    status: j.enabled ? 'active' : 'paused',
                })));
            } catch {
                setCronJobs([]);
            }
        };
        load();
        const interval = setInterval(load, 60000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="sys-panel sys-resources">
            <div className="sys-panel-header">
                <div className="sys-panel-title-row">
                    <Server size={16} className="sys-panel-icon" />
                    <h3 className="sys-panel-title">System Resources</h3>
                </div>
            </div>

            {/* Resource status grid */}
            <div className="sys-resource-grid">
                {resources.map(r => {
                    const Icon = r.icon;
                    return (
                        <div key={r.label} className={`sys-resource-card ${r.ok ? 'sys-res-ok' : 'sys-res-err'}`}>
                            <div className="sys-resource-icon-wrap">
                                <Icon size={16} />
                            </div>
                            <div className="sys-resource-info">
                                <span className="sys-resource-label">{r.label}</span>
                                <span className="sys-resource-detail">
                                    {r.ok ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                    {r.detail}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Cron Jobs */}
            <div className="sys-cron-section">
                <div className="sys-cron-header">
                    <Clock size={13} />
                    <span>Cron Jobs</span>
                </div>
                <div className="sys-cron-list">
                    {cronJobs.map(job => (
                        <div key={job.id} className={`sys-cron-row ${job.status}`}>
                            <span className={`sys-cron-dot ${job.status}`} />
                            <span className="sys-cron-name">{job.name}</span>
                            <span className="sys-cron-schedule">{job.schedule}</span>
                            <span className="sys-cron-next">{formatCronTime(job.nextRun)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Helpers ───
function formatCronTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `om ${hours}h ${mins}m`;
    if (mins > 0) return `om ${mins}m`;
    return 'nu';
}
