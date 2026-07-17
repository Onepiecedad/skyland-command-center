import { AlertTriangle, CheckCircle2, XCircle, Clock, ListTodo } from 'lucide-react';
import type { Customer } from '../api';

interface Props {
    customer: Customer;
    isSelected: boolean;
    onClick: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    error: { color: '#ef4444', label: 'Kritisk', icon: <XCircle size={12} strokeWidth={2.2} /> },
    warning: { color: '#f59e0b', label: 'Varning', icon: <AlertTriangle size={12} strokeWidth={2.2} /> },
    active: { color: '#34d399', label: 'Aktiv', icon: <CheckCircle2 size={12} strokeWidth={2.2} /> },
};

/** Verksamhetskontext per kund — ett kort ska berätta VEM det är, inte bara namnet */
const BUSINESS: Record<string, { tagline: string; emoji: string }> = {
    thomas: { tagline: 'Marinmekanik · verkstad & service', emoji: '⚓' },
    axel: { tagline: 'Livsmedelsbutik · Hasselblads', emoji: '🛒' },
    gustav: { tagline: 'Upplevelser · kallbad & event', emoji: '❄️' },
};

function initials(name: string): string {
    return name.split(/[\s—-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatTimeAgo(iso: string | null): string {
    if (!iso) return 'ingen aktivitet ännu';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'aktiv just nu';
    if (mins < 60) return `${mins} min sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h sedan`;
    return `${Math.floor(hours / 24)} d sedan`;
}

function StatusRing({ percent, color, size }: { percent: number; color: string; size: number }) {
    const strokeWidth = 3;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    return (
        <svg width={size} height={size} className="cc3-ring">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} />
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
    );
}

export function CustomerCard({ customer, isSelected, onClick }: Props) {
    const cfg = STATUS_CONFIG[customer.status] || STATUS_CONFIG.active;
    const biz = BUSINESS[customer.slug] ?? { tagline: 'Kundinstans', emoji: '🏢' };
    const calm = customer.status === 'active' && customer.errors_24h === 0 && customer.warnings_24h === 0;

    const healthScore = customer.status === 'error'
        ? Math.max(10, 100 - customer.errors_24h * 20)
        : customer.status === 'warning'
            ? Math.max(30, 100 - customer.warnings_24h * 10)
            : 100;

    return (
        <div className={`customer-card-v3 status-${customer.status} ${isSelected ? 'selected' : ''}`} onClick={onClick}>
            <div className="cc3-glow" />

            {/* Monogram i statusring */}
            <div className="cc3-avatar-wrap">
                <StatusRing percent={healthScore} color={cfg.color} size={76} />
                <span className="cc3-monogram">{initials(customer.name)}</span>
                <span className="cc3-emoji">{biz.emoji}</span>
            </div>

            <div className="cc3-name">{customer.name.split(/[—-]/)[0].trim()}</div>
            <div className="cc3-tagline">{biz.tagline}</div>

            <div className="cc3-status-row">
                <span className="cc3-status-chip" style={{ color: cfg.color }}>{cfg.icon}{cfg.label}</span>
                <span className="cc3-time"><Clock size={10} /> {formatTimeAgo(customer.last_activity)}</span>
            </div>

            {/* Lugnt läge i klartext — siffror bara vid avvikelser */}
            {calm ? (
                <div className="cc3-calm">Allt lugnt — inga fel eller varningar senaste dygnet</div>
            ) : (
                <div className="cc3-alerts">
                    {customer.errors_24h > 0 && <span className="cc3-alert cc3-alert--error">{customer.errors_24h} fel</span>}
                    {customer.warnings_24h > 0 && <span className="cc3-alert cc3-alert--warn">{customer.warnings_24h} varningar</span>}
                </div>
            )}

            {customer.open_tasks > 0 && (
                <div className="cc3-tasks"><ListTodo size={12} /> {customer.open_tasks} öppna uppgifter</div>
            )}
        </div>
    );
}
