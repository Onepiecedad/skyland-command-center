import { useCallback, useEffect, useState } from 'react';
import { fetchContactConversation, sendContactSms, type ConversationMessage } from '../api';

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
    const [phone, setPhone] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [utkast, setUtkast] = useState('');
    const [skickar, setSkickar] = useState(false);
    const [smsFel, setSmsFel] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchContactConversation(contactId);
            setMessages(data.messages);
            setName((data.contact?.name as string) ?? null);
            setPhone((data.contact?.phone as string) ?? null);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunde inte hämta tråd');
        }
        setLoading(false);
    }, [contactId]);

    useEffect(() => {
        void load();
    }, [load]);

    // Ett handskrivet sms stoppar den automatiska sekvensen i backenden, så
    // roboten aldrig tjatar parallellt med dig.
    const skicka = async (payload?: { template: 'call_ahead' }) => {
        const text = utkast.trim();
        if (!payload && (!text || skickar)) return;
        if (skickar) return;
        setSkickar(true);
        setSmsFel(null);
        try {
            await sendContactSms(contactId, payload ?? text);
            if (!payload) setUtkast('');
            // Utskicket sker i edge-funktionen och loggas när 46elks svarat.
            // Två laddningar: den första fångar det vanliga fallet, den andra
            // täcker en trög provider utan att kräva att du laddar om sidan.
            setTimeout(() => { void load(); }, 1500);
            setTimeout(() => { void load(); }, 5000);
        } catch (err) {
            setSmsFel(err instanceof Error ? err.message : 'Kunde inte skicka');
        }
        setSkickar(false);
    };

    // 160 tecken = ett segment. Över det kostar utskicket dubbelt.
    const segment = utkast.length === 0 ? 0 : utkast.length <= 160 ? 1 : Math.ceil(utkast.length / 153);

    return (
        <div style={{
            background: 'rgba(20,22,30,0.9)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            // Flödar naturligt — den yttre panelen (crm-detail) sköter scrollen.
            // Tidigare dubbel scroll (panel + inre lista) klämde sista meddelandet.
            minWidth: 0,
            maxWidth: '100%',
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
                {messages.map((m) => {
                    const outbound = m.direction === 'outbound' || m.role === 'assistant';
                    // Skuggläge (SCC-46): det här mejlet skickades ALDRIG — det är vad
                    // sekvensmotorn hade skickat. Streckad ram + tydlig stämpel så det
                    // aldrig förväxlas med ett riktigt utskick.
                    const shadow = m.status === 'shadow';
                    const bounced = m.status === 'bounced' || m.status === 'complained';
                    return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                            <div style={{
                                // Ett meddelande med en lång obrytbar sträng (länk, e-postadress,
                                // telefonnummer utan mellanslag) sprängde bubblan bredare än
                                // skärmen. maxWidth håller bara lådan — texten måste få brytas,
                                // annars rinner den ut och hela tråden blir dragbar i sidled.
                                maxWidth: '78%',
                                minWidth: 0,
                                overflowWrap: 'anywhere',
                                wordBreak: 'break-word',
                                background: shadow ? 'rgba(233,169,74,0.08)' : outbound ? 'rgba(90,140,255,0.18)' : 'rgba(255,255,255,0.06)',
                                border: shadow ? '1px dashed rgba(233,169,74,0.6)' : bounced ? '1px solid rgba(255,107,107,0.6)' : '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 12,
                                padding: '8px 12px',
                            }}>
                                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 3 }}>
                                    {channelIcon[m.channel] || '•'} {m.channel} · {new Date(m.created_at).toLocaleString('sv-SE')}
                                    {shadow && (
                                        <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 6, background: 'rgba(233,169,74,0.25)', color: '#E9A94A', fontWeight: 600, letterSpacing: 0.5 }}>
                                            SKUGGA · ej skickat
                                        </span>
                                    )}
                                    {bounced && (
                                        <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 6, background: 'rgba(255,107,107,0.25)', color: '#ff6b6b', fontWeight: 600 }}>
                                            {m.status === 'bounced' ? 'STUDSADE' : 'KLAGOMÅL'}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {phone && (
                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                    <textarea
                        value={utkast}
                        onChange={(e) => setUtkast(e.target.value)}
                        onKeyDown={(e) => {
                            // Enter skickar, Shift+Enter ger ny rad.
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void skicka(); }
                        }}
                        placeholder={`Skriv ett sms till ${phone}…`}
                        rows={3}
                        style={{
                            width: '100%', boxSizing: 'border-box', resize: 'vertical',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 10, padding: '8px 10px',
                            color: 'inherit', fontSize: 14, fontFamily: 'inherit',
                        }}
                    />
                    {/* Knappraden bryter till ny rad på smal skärm i stället för att
                        tvinga fram sidoscroll i panelen. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 11, opacity: 0.5 }}>
                            {utkast.length} tecken{segment > 1 ? ` · ${segment} sms` : ''}
                        </div>
                        {smsFel && <div style={{ fontSize: 12, color: '#ff6b6b' }}>{smsFel}</div>}
                        <button
                            onClick={() => void skicka({ template: 'call_ahead' })}
                            disabled={skickar}
                            title="Skickar 'jag ringer dig om fem minuter från 073-…' så ditt nummer är väntat när du ringer"
                            style={{
                                marginLeft: 'auto',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 10, padding: '6px 12px',
                                color: 'inherit', fontSize: 13,
                                cursor: skickar ? 'default' : 'pointer',
                                opacity: skickar ? 0.6 : 1,
                            }}
                        >
                            📞 Ringer om 5 min
                        </button>
                        <button
                            onClick={() => void skicka()}
                            disabled={skickar || utkast.trim().length === 0}
                            style={{
                                background: utkast.trim() ? 'rgba(90,140,255,0.35)' : 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 10, padding: '6px 16px',
                                color: 'inherit', fontSize: 13, fontWeight: 600,
                                cursor: skickar || !utkast.trim() ? 'default' : 'pointer',
                                opacity: skickar ? 0.6 : 1,
                            }}
                        >
                            {skickar ? 'Skickar…' : 'Skicka sms'}
                        </button>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.4, marginTop: 6 }}>
                        Enter skickar · Shift+Enter ny rad · stoppar den automatiska uppföljningen
                    </div>
                </div>
            )}
        </div>
    );
}

export default ConversationInbox;
