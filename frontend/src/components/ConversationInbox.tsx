import { useCallback, useEffect, useState } from 'react';
import { fetchContactConversation, type ConversationMessage } from '../api';

/**
 * ConversationInbox (SCC-26) — unified inbox: alla messages för EN kontakt,
 * över alla kanaler (chat/voice/email/sms/webhook), som en tidsordnad tråd.
 */

interface ConversationInboxProps {
    contactId: string;
    title?: string;
    onClose?: () => void;
}

const channelIcon: Record<string, string> = {
    chat: '💬', voice: '🎙️', email: '✉️', sms: '📱', whatsapp: '🟢', webhook: '🔗',
};

export function ConversationInbox({ contactId, title, onClose }: ConversationInboxProps) {
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [name, setName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchContactConversation(contactId);
            setMessages(data.messages);
            setName((data.contact?.name as string) ?? null);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta tråd');
        }
        setLoading(false);
    }, [contactId]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div style={{
            background: 'rgba(20,22,30,0.9)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{name || title || 'Konversation'}</div>
                    <div style={{ fontSize: 12, opacity: 0.5 }}>{messages.length} meddelanden · alla kanaler</div>
                </div>
                {onClose && (
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 18 }}>✕</button>
                )}
            </div>

            {loading && <p style={{ opacity: 0.6 }}>Laddar…</p>}
            {error && <p style={{ color: '#ff6b6b' }}>Fel: {error}</p>}
            {!loading && !error && messages.length === 0 && (
                <p style={{ opacity: 0.45, fontSize: 13 }}>Inga meddelanden än för den här kontakten.</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {messages.map((m) => {
                    const outbound = m.direction === 'outbound' || m.role === 'assistant';
                    return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start' }}>
                            <div style={{
                                maxWidth: '78%',
                                background: outbound ? 'rgba(90,140,255,0.18)' : 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 12,
                                padding: '8px 12px',
                            }}>
                                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 3 }}>
                                    {channelIcon[m.channel] || '•'} {m.channel} · {new Date(m.created_at).toLocaleString('sv-SE')}
                                </div>
                                <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default ConversationInbox;
