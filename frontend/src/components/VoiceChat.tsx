import { useState, useEffect, useRef, useCallback } from 'react';
import { Conversation } from '@elevenlabs/client';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type AgentMode = 'listening' | 'speaking';

interface TranscriptEntry {
    role: 'user' | 'agent';
    text: string;
    final: boolean;
    timestamp: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function VoiceChat() {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [agentMode, setAgentMode] = useState<AgentMode>('listening');
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(0.8);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [inputLevel, setInputLevel] = useState(0);
    const [outputLevel, setOutputLevel] = useState(0);
    const [configured, setConfigured] = useState<boolean | null>(null);

    const conversationRef = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement | null>(null);
    const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

    // ── Check if ElevenLabs is configured ──
    useEffect(() => {
        fetch(`${BACKEND_URL}/api/v1/voice/status`)
            .then(r => r.json())
            .then(data => setConfigured(data.configured))
            .catch(() => setConfigured(false));
    }, [BACKEND_URL]);

    // ── Auto-scroll transcript ──
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    // ── Clean up on unmount ──
    useEffect(() => {
        return () => {
            if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
            if (conversationRef.current) {
                conversationRef.current.endSession();
            }
        };
    }, []);

    // ── Start conversation ──
    const startConversation = useCallback(async () => {
        setError(null);
        setStatus('connecting');
        setTranscript([]);

        try {
            // Request mic permission first
            await navigator.mediaDevices.getUserMedia({ audio: true });

            // Get signed URL from backend
            const response = await fetch(`${BACKEND_URL}/api/v1/voice/signed-url`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || 'Kunde inte hämta signerad URL');
            }
            const { signedUrl } = await response.json();

            // Start ElevenLabs session
            const conversation = await Conversation.startSession({
                signedUrl,
                onConnect: () => {
                    setStatus('connected');
                    setError(null);
                },
                onDisconnect: () => {
                    setStatus('disconnected');
                    setAgentMode('listening');
                    if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
                },
                onError: (err: unknown) => {
                    console.error('[VoiceChat] error:', err);
                    const msg = err instanceof Error ? err.message : String(err);
                    setError(msg);
                    setStatus('error');
                },
                onModeChange: (mode: { mode: string }) => {
                    setAgentMode(mode.mode === 'speaking' ? 'speaking' : 'listening');
                },
                onMessage: (message: { source: string; message: string }) => {
                    const role = message.source === 'user' ? 'user' : 'agent';
                    setTranscript(prev => {
                        // Replace last tentative entry from same role
                        const last = prev[prev.length - 1];
                        if (last && last.role === role && !last.final) {
                            return [...prev.slice(0, -1), {
                                role,
                                text: message.message,
                                final: true,
                                timestamp: Date.now(),
                            }];
                        }
                        return [...prev, {
                            role,
                            text: message.message,
                            final: true,
                            timestamp: Date.now(),
                        }];
                    });
                },
            });

            conversationRef.current = conversation;
            await conversation.setVolume({ volume });

            // Audio level polling
            levelIntervalRef.current = setInterval(async () => {
                if (conversationRef.current) {
                    try {
                        const inVol = await conversationRef.current.getInputVolume();
                        const outVol = await conversationRef.current.getOutputVolume();
                        setInputLevel(inVol);
                        setOutputLevel(outVol);
                    } catch {
                        // ignore - conversation may have ended
                    }
                }
            }, 100);

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Okänt fel';
            console.error('[VoiceChat] start error:', msg);
            setError(msg);
            setStatus('error');
        }
    }, [BACKEND_URL, volume]);

    // ── Stop conversation ──
    const stopConversation = useCallback(async () => {
        if (levelIntervalRef.current) {
            clearInterval(levelIntervalRef.current);
            levelIntervalRef.current = null;
        }
        if (conversationRef.current) {
            await conversationRef.current.endSession();
            conversationRef.current = null;
        }
        setStatus('disconnected');
        setAgentMode('listening');
        setInputLevel(0);
        setOutputLevel(0);
    }, []);

    // ── Toggle mute ──
    const toggleMute = useCallback(() => {
        if (conversationRef.current) {
            const newMuted = !isMuted;
            conversationRef.current.setMicMuted(newMuted);
            setIsMuted(newMuted);
        }
    }, [isMuted]);

    // ── Volume change ──
    const handleVolumeChange = useCallback((newVol: number) => {
        setVolume(newVol);
        if (conversationRef.current) {
            conversationRef.current.setVolume({ volume: newVol });
        }
    }, []);

    // ── Not configured state ──
    if (configured === false) {
        return (
            <div className="vc-not-configured">
                <div className="vc-not-configured-icon">🎙️</div>
                <h3>Röstchat ej konfigurerad</h3>
                <p>Ange <code>ELEVENLABS_API_KEY</code> och <code>ELEVENLABS_AGENT_ID</code> i backend <code>.env</code></p>
            </div>
        );
    }

    const isActive = status === 'connected';
    const isConnecting = status === 'connecting';

    return (
        <div className="vc-container">
            {/* ── Orb ── */}
            <div className={`vc-orb-area ${isActive ? 'vc-orb-area--active' : ''}`}>
                <div className={`vc-orb ${isActive ? (agentMode === 'speaking' ? 'vc-orb--speaking' : 'vc-orb--listening') : ''} ${isConnecting ? 'vc-orb--connecting' : ''}`}>
                    {/* Audio rings */}
                    {isActive && (
                        <>
                            <div className="vc-ring vc-ring--1" style={{ opacity: agentMode === 'speaking' ? outputLevel : inputLevel }} />
                            <div className="vc-ring vc-ring--2" style={{ opacity: (agentMode === 'speaking' ? outputLevel : inputLevel) * 0.6 }} />
                            <div className="vc-ring vc-ring--3" style={{ opacity: (agentMode === 'speaking' ? outputLevel : inputLevel) * 0.3 }} />
                        </>
                    )}
                    <div className="vc-orb-inner">
                        {isConnecting ? (
                            <div className="vc-spinner" />
                        ) : isActive ? (
                            agentMode === 'speaking' ? <Volume2 size={32} /> : <Mic size={32} />
                        ) : (
                            <Phone size={32} />
                        )}
                    </div>
                </div>
            </div>

            {/* ── Status label ── */}
            <div className="vc-status-label">
                {isConnecting && 'Ansluter...'}
                {isActive && agentMode === 'listening' && '🎧 Alex lyssnar...'}
                {isActive && agentMode === 'speaking' && '🔊 Alex pratar...'}
                {status === 'disconnected' && 'Tryck för att ringa Alex'}
                {status === 'error' && '❌ Anslutningsfel'}
            </div>

            {/* ── Call button ── */}
            <div className="vc-controls">
                {!isActive && !isConnecting ? (
                    <button className="vc-btn vc-btn--call" onClick={startConversation}>
                        <Phone size={20} />
                        Ring upp Alex
                    </button>
                ) : (
                    <div className="vc-controls-row">
                        <button
                            className={`vc-btn vc-btn--icon ${isMuted ? 'vc-btn--muted' : ''}`}
                            onClick={toggleMute}
                            title={isMuted ? 'Slå på mikrofon' : 'Stäng av mikrofon'}
                        >
                            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                        </button>

                        <button className="vc-btn vc-btn--hangup" onClick={stopConversation}>
                            <PhoneOff size={20} />
                            Lägg på
                        </button>

                        <button
                            className="vc-btn vc-btn--icon"
                            onClick={() => handleVolumeChange(volume > 0 ? 0 : 0.8)}
                            title={volume === 0 ? 'Ljud på' : 'Ljud av'}
                        >
                            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                    </div>
                )}
            </div>

            {/* ── Volume slider (when active) ── */}
            {isActive && (
                <div className="vc-volume-slider">
                    <Volume2 size={14} />
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={volume}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    />
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="vc-error">
                    <span>⚠️ {error}</span>
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {/* ── Transcript ── */}
            {transcript.length > 0 && (
                <div className="vc-transcript">
                    <h4 className="vc-transcript-title">Transkription</h4>
                    <div className="vc-transcript-messages">
                        {transcript.map((entry, i) => (
                            <div key={i} className={`vc-msg vc-msg--${entry.role}`}>
                                <span className="vc-msg-role">{entry.role === 'user' ? 'Du' : 'Alex'}</span>
                                <span className="vc-msg-text">{entry.text}</span>
                            </div>
                        ))}
                        <div ref={transcriptEndRef} />
                    </div>
                </div>
            )}
        </div>
    );
}
