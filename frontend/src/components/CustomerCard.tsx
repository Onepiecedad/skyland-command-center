import { AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { Customer } from '../api';

interface Props {
    customer: Customer;
    isSelected: boolean;
    onClick: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode; rgb: string }> = {
    error: {
        color: '#ef4444',
        label: 'Kritisk',
        icon: <XCircle size={13} strokeWidth={2.2} />,
        rgb: '239, 68, 68',
    },
    warning: {
        color: '#f59e0b',
        label: 'Varning',
        icon: <AlertTriangle size={13} strokeWidth={2.2} />,
        rgb: '245, 158, 11',
    },
    active: {
        color: '#30d158',
        label: 'Aktiv',
        icon: <CheckCircle2 size={13} strokeWidth={2.2} />,
        rgb: '48, 209, 88',
    },
};

function ProgressRing({ percent, color, size = 42 }: { percent: number; color: string; size?: number }) {
    const strokeWidth = 3;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    return (
        <svg width={size} height={size} className="progress-ring">
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={strokeWidth}
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className="progress-ring-fill"
            />
        </svg>
    );
}

function formatTimeAgo(iso: string | null): string {
    if (!iso) return 'Ingen aktivitet';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    return `${Math.floor(hours / 24)}d sedan`;
}

export function CustomerCard({ customer, isSelected, onClick }: Props) {
    const cfg = STATUS_CONFIG[customer.status] || STATUS_CONFIG.active;

    const healthScore = customer.status === 'error'
        ? Math.max(10, 100 - customer.errors_24h * 20)
        : customer.status === 'warning'
            ? Math.max(30, 100 - customer.warnings_24h * 10)
            : 100;

    return (
        <div
            className={`customer-card-v2 status-${customer.status} ${isSelected ? 'selected' : ''}`}
            onClick={onClick}
        >
            {/* Gradient border glow */}
            <div className="cc-glow" />

            <div className="cc-top">
                <div className="cc-ring-wrap">
                    <ProgressRing percent={healthScore} color={cfg.color} size={44} />
                    <span className={`cc-ring-label status-text-${customer.status}`}>
                        {cfg.icon}
                        {cfg.label}
                    </span>
                </div>
                <div className="cc-info">
                    <span className="cc-name">{customer.name}</span>
                    <span className="cc-time">
                        <Clock size={10} />
                        {formatTimeAgo(customer.last_activity)}
                    </span>
                </div>
            </div>
            <div className="cc-stats">
                <span className="cc-stat cc-stat-error" title="Errors 24h">
                    <span className="cc-stat-dot cc-dot-error" />
                    {customer.errors_24h}
                </span>
                <span className="cc-stat cc-stat-warn" title="Warnings 24h">
                    <span className="cc-stat-dot cc-dot-warn" />
                    {customer.warnings_24h}
                </span>
                <span className="cc-stat cc-stat-tasks" title="Open tasks">
                    <span className="cc-stat-dot cc-dot-tasks" />
                    {customer.open_tasks}
                </span>
            </div>
        </div>
    );
}
