import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatResponse, Task } from '../api';
import { sendChatMessage } from '../api';
import { useGateway } from '../gateway/useGateway';
import {
    Brain,
    Zap,
    Sparkles,
    ChevronDown,
    Check,
    Plus,
    Paperclip,
    Image,
    FileCode,
    Lightbulb,
    SendHorizontal,
    Square,
} from 'lucide-react';

type ChatMode = 'masterbrain' | 'alex';

interface Props {
    onTaskCreated: () => void;
}

interface MBMessage {
    role: 'user' | 'assistant';
    content: string;
    intent?: string;
    proposedActions?: Array<{ type: string; task_id?: string; task?: Task }>;
    suggestions?: string[];
    timestamp?: string;
}

function formatTime(ts?: string): string {
    if (!ts) return '';
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

const STATUS_LABELS: Record<string, string> = {
    connected: 'Online',
    connecting: 'Connecting…',
    disconnected: 'Offline',
};

const ALEX_STATE_LABELS: Record<string, string> = {
    idle: 'Idle',
    thinking: 'Thinking…',
    executing: 'Running tools…',
    stuck: 'Stuck',
    unknown: '',
};

/* ─── Model Selector ─── */
interface Model {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    badge?: string;
}

const MODELS: Model[] = [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship', icon: <Sparkles size={14} className="bolt-model-icon bolt-icon-green" />, badge: 'Default' },
    { id: 'sonnet-4', name: 'Sonnet 4', description: 'Fast & intelligent', icon: <Zap size={14} className="bolt-model-icon bolt-icon-blue" /> },
    { id: 'opus-4', name: 'Opus 4', description: 'Most capable', icon: <Sparkles size={14} className="bolt-model-icon bolt-icon-purple" />, badge: 'Pro' },
    { id: 'gemini-2.5', name: 'Gemini 2.5', description: 'Google AI', icon: <Brain size={14} className="bolt-model-icon bolt-icon-cyan" /> },
];

function ModelSelector() {
    const [isOpen, setIsOpen] = useState(false);
    const [selected, setSelected] = useState(MODELS[0]);

    const handleSelect = (model: Model) => {
        setSelected(model);
        setIsOpen(false);
    };

    return (
        <div className="bolt-model-selector">
            <button
                className="bolt-model-trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                {selected.icon}
                <span>{selected.name}</span>
                <ChevronDown size={12} className={`bolt-chevron ${isOpen ? 'open' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div className="bolt-dropdown-backdrop" onClick={() => setIsOpen(false)} />
                    <div className="bolt-model-dropdown">
                        <div className="bolt-dropdown-label">Select Model</div>
                        {MODELS.map((model) => (
                            <button
                                key={model.id}
                                className={`bolt-model-option ${selected.id === model.id ? 'active' : ''}`}
                                onClick={() => handleSelect(model)}
                            >
                                <div className="bolt-model-option-icon">{model.icon}</div>
                                <div className="bolt-model-option-info">
                                    <div className="bolt-model-option-row">
                                        <span className="bolt-model-option-name">{model.name}</span>
                                        {model.badge && (
                                            <span className={`bolt-model-badge ${model.badge === 'Pro' ? 'pro' : 'default'}`}>
                                                {model.badge}
                                            </span>
                                        )}
                                    </div>
                                    <span className="bolt-model-option-desc">{model.description}</span>
                                </div>
                                {selected.id === model.id && <Check size={14} className="bolt-icon-blue" />}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* ─── Attach Menu ─── */
function AttachMenu() {
    const [isOpen, setIsOpen] = useState(false);

    const items = [
        { icon: <Paperclip size={14} />, label: 'Ladda upp fil' },
        { icon: <Image size={14} />, label: 'Lägg till bild' },
        { icon: <FileCode size={14} />, label: 'Importera kod' },
    ];

    return (
        <div className="bolt-attach">
            <button
                className="bolt-attach-trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                <Plus size={14} className={isOpen ? 'bolt-rotate-45' : ''} />
            </button>

            {isOpen && (
                <>
                    <div className="bolt-dropdown-backdrop" onClick={() => setIsOpen(false)} />
                    <div className="bolt-attach-dropdown">
                        {items.map((item, i) => (
                            <button key={i} className="bolt-attach-option" onClick={() => setIsOpen(false)}>
                                {item.icon}
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* ─── Main Component ─── */
export function MasterBrainChat({ onTaskCreated }: Props) {
    const [chatMode, setChatMode] = useState<ChatMode>('alex');
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);

    // MasterBrain state (HTTP)
    const [mbMessages, setMbMessages] = useState<MBMessage[]>([]);
    const [mbConvoId, setMbConvoId] = useState<string | null>(null);

    // Alex state (WebSocket)
    const gateway = useGateway('agent:skyland:main');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [gateway.messages, gateway.streamingContent, mbMessages]);

    // Auto-resize textarea
    const autoResize = useCallback(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
        }
    }, []);

    useEffect(() => { autoResize(); }, [input, autoResize]);

    // --- MasterBrain send ---
    const handleMBSend = async (text: string) => {
        setSending(true);
        setMbMessages(prev => [...prev, { role: 'user', content: text }]);
        try {
            const response: ChatResponse = await sendChatMessage(text, mbConvoId || undefined);
            setMbConvoId(response.conversation_id);
            setMbMessages(prev => [...prev, {
                role: 'assistant',
                content: response.response,
                intent: response.intent,
                proposedActions: response.proposed_actions,
                suggestions: response.suggestions,
            }]);
            if (response.intent === 'CREATE_TASK' && response.proposed_actions.length > 0) {
                onTaskCreated();
            }
        } catch {
            setMbMessages(prev => [...prev, {
                role: 'assistant',
                content: '⚠️ Error: Could not reach MasterBrain',
            }]);
        }
        setSending(false);
    };

    // --- Send handler ---
    const handleSend = () => {
        if (!input.trim() || sending) return;
        const text = input.trim();
        setInput('');

        if (chatMode === 'masterbrain') {
            handleMBSend(text);
        } else {
            gateway.sendMessage(text);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const inputDisabled = chatMode === 'masterbrain'
        ? sending
        : gateway.status === 'disconnected';

    const alexOnline = gateway.status === 'connected';
    const alexBusy = gateway.isStreaming || gateway.alexState === 'thinking' || gateway.alexState === 'executing';

    return (
        <div className={`panel chat-panel ${chatMode === 'alex' ? 'chat-alex-mode' : ''}`}>
            {/* Header */}
            <div className="chat-header">
                <div className="chat-mode-toggle">
                    <button
                        className={`chat-mode-btn ${chatMode === 'masterbrain' ? 'active' : ''}`}
                        onClick={() => setChatMode('masterbrain')}
                    >
                        <Brain size={13} />
                        MasterBrain
                    </button>
                    <button
                        className={`chat-mode-btn ${chatMode === 'alex' ? 'active' : ''}`}
                        onClick={() => setChatMode('alex')}
                    >
                        <span className={`gateway-dot ${alexOnline ? 'online' : 'offline'}`} />
                        <Zap size={13} />
                        Alex
                    </button>
                </div>

                {chatMode === 'alex' && (
                    <div className="alex-status-bar">
                        <span className={`alex-status-label ${gateway.status}`}>
                            {STATUS_LABELS[gateway.status] || gateway.status}
                        </span>
                        {alexOnline && gateway.alexState !== 'unknown' && (
                            <span className={`alex-state ${gateway.alexState}`}>
                                {ALEX_STATE_LABELS[gateway.alexState]}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Messages */}
            <div className="chat-messages">
                {chatMode === 'masterbrain' ? (
                    mbMessages.length === 0 ? (
                        <p className="empty">Start a conversation with MasterBrain…</p>
                    ) : (
                        mbMessages.map((msg, i) => (
                            <div key={i} className={`chat-message ${msg.role}`}>
                                <div className="message-content">{msg.content}</div>
                                {msg.timestamp && <span className="msg-timestamp">{formatTime(msg.timestamp)}</span>}
                                {msg.intent && <span className="intent-badge">{msg.intent}</span>}
                                {msg.proposedActions && msg.proposedActions.length > 0 && (
                                    <div className="proposed-actions">
                                        {msg.proposedActions.map((action, j) => (
                                            <div key={j} className="proposed-action">
                                                📋 {action.type}: {action.task?.title || action.task_id}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {msg.suggestions && msg.suggestions.length > 0 && (
                                    <div className="suggestions">
                                        {msg.suggestions.map((s, j) => (
                                            <button
                                                key={j}
                                                className="suggestion-chip"
                                                onClick={() => setInput(s)}
                                            >{s}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                ) : (
                    gateway.messages.length === 0 && !gateway.isStreaming ? (
                        <p className="empty">
                            {alexOnline ? 'Talk to Alex…' : 'Connecting to Alex gateway…'}
                        </p>
                    ) : (
                        <>
                            {gateway.messages.map((msg, i) => (
                                <div key={i} className={`chat-message ${msg.role} ${msg.role === 'assistant' ? 'alex' : ''}`}>
                                    <div className="message-content">{msg.content}</div>
                                    {msg.timestamp && <span className="msg-timestamp">{formatTime(msg.timestamp)}</span>}
                                </div>
                            ))}
                            {gateway.isStreaming && gateway.streamingContent && (
                                <div className="chat-message assistant alex streaming">
                                    <div className="message-content">
                                        {gateway.streamingContent}
                                        <span className="streaming-cursor" />
                                    </div>
                                </div>
                            )}
                            {gateway.isStreaming && !gateway.streamingContent && (
                                <div className="chat-message assistant alex streaming">
                                    <div className="message-content">
                                        <span className="thinking-dots">
                                            <span /><span /><span />
                                        </span>
                                    </div>
                                </div>
                            )}
                        </>
                    )
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ─── Bolt-Style Input ─── */}
            <div className="bolt-input-wrapper">
                <div className="bolt-input-glow" />
                <div className="bolt-input-card">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={chatMode === 'alex' ? 'Prata med Alex…' : 'Fråga MasterBrain…'}
                        disabled={inputDisabled}
                        className="bolt-textarea"
                        rows={1}
                    />

                    <div className="bolt-toolbar">
                        <div className="bolt-toolbar-left">
                            <AttachMenu />
                            <ModelSelector />
                        </div>

                        <div className="bolt-toolbar-right">
                            <button className="bolt-plan-btn" title="Plan">
                                <Lightbulb size={14} />
                                <span>Plan</span>
                            </button>

                            {chatMode === 'alex' && alexBusy ? (
                                <button
                                    className="bolt-abort-btn"
                                    onClick={gateway.abortChat}
                                    title="Stop Alex"
                                >
                                    <Square size={12} />
                                    <span>Stop</span>
                                </button>
                            ) : (
                                <button
                                    className="bolt-send-btn"
                                    onClick={handleSend}
                                    disabled={inputDisabled || !input.trim()}
                                >
                                    <span>Skicka</span>
                                    <SendHorizontal size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
