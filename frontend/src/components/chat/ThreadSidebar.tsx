import { useMemo } from 'react';
import { Plus, MessageCircle, Radio, Phone, Clock, Hash } from 'lucide-react';
import type { GatewaySession } from '../../gateway/gatewaySocket';
import type { ThreadPreview } from '../../gateway/useGateway';

interface ThreadSidebarProps {
    sessions: GatewaySession[];
    activeSessionKey: string;
    threadPreviews: Record<string, ThreadPreview>;
    onSelectSession: (key: string) => void;
    onNewThread: () => void;
}

/* ─── Helpers ─── */

function getChannelIcon(session: GatewaySession) {
    const key = session.key || '';
    if (key.includes('whats')) return <Phone size={12} />;
    if (key.includes('cron')) return <Clock size={12} />;
    if (key.includes('scc')) return <Hash size={12} />;
    return <MessageCircle size={12} />;
}

function getChannelLabel(session: GatewaySession): string {
    const key = session.key || '';
    if (key.includes('whatsapp') || key.includes('whats')) return 'WhatsApp';
    if (key.includes('cron')) return 'Cron';
    if (key.includes('scc')) return 'SCC';
    return 'Direct';
}

function getThreadLabel(session: GatewaySession): string {
    if (session.label) return session.label;

    const key = session.key || '';
    // Extract readable name from session key
    // e.g. "agent:main:scc:abc123" → "SCC abc123"
    //      "agent:main:cron:...bc8f29" → "Cron bc8f29"
    //      "agent:main:main" → "Main"
    //      "agent:main:whatsapp:..." → "WhatsApp"

    const parts = key.split(':');
    if (parts.length >= 4) {
        const type = parts[2];
        const id = parts[3];
        if (type === 'scc') return `Tråd ${id.slice(0, 6)}`;
        if (type === 'cron') return `Cron ${id.slice(-6)}`;
        if (type.includes('whats')) return 'WhatsApp';
        return `${type} ${id.slice(0, 6)}`;
    }
    if (parts.length === 3 && parts[2] === 'main') return 'Alex — Huvudtråd';
    return key.slice(-12);
}

function formatTimeAgo(iso?: string): string {
    if (!iso) return '';
    const now = Date.now();
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';

    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Nu';
    if (mins < 60) return `${mins}m sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Igår';
    return `${days}d sedan`;
}

/* ─── Component ─── */

export function ThreadSidebar({
    sessions,
    activeSessionKey,
    threadPreviews,
    onSelectSession,
    onNewThread,
}: ThreadSidebarProps) {
    // Sort sessions: active first, then by lastMessageAt
    const sortedSessions = useMemo(() => {
        return [...sessions].sort((a, b) => {
            // Active session always first
            if (a.key === activeSessionKey) return -1;
            if (b.key === activeSessionKey) return 1;
            // Then by last message time (newest first)
            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bTime - aTime;
        });
    }, [sessions, activeSessionKey]);

    return (
        <div className="thread-sidebar">
            {/* New Thread Button */}
            <button className="thread-new-btn" onClick={onNewThread}>
                <Plus size={14} />
                <span>Ny tråd</span>
            </button>

            {/* Thread List */}
            <div className="thread-list">
                {sortedSessions.length === 0 && (
                    <div className="thread-empty">
                        <Radio size={16} />
                        <span>Inga aktiva trådar</span>
                    </div>
                )}

                {sortedSessions.map(session => {
                    const isActive = session.key === activeSessionKey;
                    return (
                        <button
                            key={session.key}
                            className={`thread-item ${isActive ? 'active' : ''}`}
                            onClick={() => onSelectSession(session.key)}
                        >
                            <div className="thread-item-icon">
                                {getChannelIcon(session)}
                            </div>
                            <div className="thread-item-body">
                                <span className="thread-item-label">
                                    {getThreadLabel(session)}
                                </span>
                                {threadPreviews[session.key]?.lastMessage ? (
                                    <span className="thread-item-preview">
                                        {threadPreviews[session.key].lastMessage}
                                    </span>
                                ) : (
                                    <span className="thread-item-meta">
                                        <span className="thread-item-channel">
                                            {getChannelLabel(session)}
                                        </span>
                                        {session.lastMessageAt && (
                                            <span className="thread-item-time">
                                                {formatTimeAgo(session.lastMessageAt)}
                                            </span>
                                        )}
                                    </span>
                                )}
                            </div>
                            {isActive && <div className="thread-item-active-dot" />}
                            {/* Preview + Badge */}
                            {(() => {
                                const preview = threadPreviews[session.key];
                                return preview && preview.messageCount > 0 ? (
                                    <span className="thread-item-badge">{preview.messageCount}</span>
                                ) : null;
                            })()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
