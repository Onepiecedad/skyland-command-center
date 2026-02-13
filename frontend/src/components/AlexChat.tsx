import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGateway, type UseGatewayResult } from '../gateway/useGateway';
import type { ChatAttachment } from '../gateway/gatewaySocket';
import {
    Zap,
    Sparkles,
    Brain,
    ChevronDown,
    Check,
    Plus,
    Paperclip,
    Image,
    FileCode,

    SendHorizontal,
    Square,
    X,
    File as FileIcon,
} from 'lucide-react';

interface Props {
    onTaskCreated: () => void;
    gateway?: UseGatewayResult;
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
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship', icon: <Sparkles size={14} className="bolt-model-icon bolt-icon-green" />, badge: 'Default' },
    { id: 'anthropic/claude-sonnet-4', name: 'Sonnet 4', description: 'Fast & intelligent', icon: <Zap size={14} className="bolt-model-icon bolt-icon-blue" /> },
    { id: 'anthropic/claude-opus-4', name: 'Opus 4', description: 'Most capable', icon: <Sparkles size={14} className="bolt-model-icon bolt-icon-purple" />, badge: 'Pro' },
    { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5', description: 'Google AI', icon: <Brain size={14} className="bolt-model-icon bolt-icon-cyan" /> },
];

function ModelSelector({ selected, onSelect }: { selected: Model; onSelect: (m: Model) => void }) {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (model: Model) => {
        onSelect(model);
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
function AttachMenu({ onImageSelect, onFileSelect }: {
    onImageSelect: () => void;
    onFileSelect: () => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    const items = [
        { icon: <Paperclip size={14} />, label: 'Ladda upp fil', action: onFileSelect },
        { icon: <Image size={14} />, label: 'Lägg till bild', action: onImageSelect },
        { icon: <FileCode size={14} />, label: 'Importera kod', action: onFileSelect },
    ];

    return (
        <div className="bolt-attach">
            <button
                className="bolt-attach-trigger"
                onClick={() => setIsOpen(!isOpen)}
                title="Bifoga"
            >
                <Plus size={14} className={isOpen ? 'bolt-rotate-45' : ''} />
            </button>

            {isOpen && (
                <>
                    <div className="bolt-dropdown-backdrop" onClick={() => setIsOpen(false)} />
                    <div className="bolt-attach-dropdown">
                        {items.map((item, i) => (
                            <button key={i} className="bolt-attach-option" onClick={() => { item.action(); setIsOpen(false); }}>
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

/* ─── Memoized Message (prevents ReactMarkdown re-renders on input change) ─── */
const remarkPlugins = [remarkGfm];
const MemoMessage = memo(function ChatMessage({ msg }: { msg: { role: string; content: string; timestamp?: string; attachments?: ChatAttachment[] } }) {
    return (
        <div className={`chat-message ${msg.role} ${msg.role === 'assistant' ? 'alex' : ''}`}>
            {msg.attachments && msg.attachments.length > 0 && (
                <div className="msg-attachments">
                    {msg.attachments.filter(a => a.preview).map(a => (
                        <img key={a.id} src={a.preview} alt={a.name} className="msg-attachment-img" />
                    ))}
                    {msg.attachments.filter(a => !a.preview).map(a => (
                        <div key={a.id} className="msg-attachment-file">
                            <FileIcon size={12} />
                            <span>{a.name}</span>
                        </div>
                    ))}
                </div>
            )}
            <div className="message-content markdown-body"><ReactMarkdown remarkPlugins={remarkPlugins}>{msg.content}</ReactMarkdown></div>
            {msg.timestamp && <span className="msg-timestamp">{formatTime(msg.timestamp)}</span>}
        </div>
    );
});

/* ─── Main Component ─── */
export function AlexChat({ gateway: externalGateway }: Props) {
    const [input, setInput] = useState('');
    const [selectedModel, setSelectedModel] = useState(MODELS[0]);

    // Alex state (WebSocket) — use external gateway if provided, otherwise internal
    const internalGateway = useGateway('agent:skyland:main', { disabled: !!externalGateway });
    const gateway = externalGateway || internalGateway;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Attachments state
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

    // File → base64 helper
    const fileToAttachment = useCallback((file: File): Promise<ChatAttachment> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = (reader.result as string).split(',')[1] || '';
                const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
                resolve({
                    id: crypto.randomUUID(),
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    data_b64: b64,
                    preview,
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }, []);

    // Paste handler (Cmd+V screenshots)
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        const newAttachments = await Promise.all(files.map(fileToAttachment));
        setAttachments(prev => [...prev, ...newAttachments]);
    }, [fileToAttachment]);

    // File input handlers
    const handleFilesSelected = useCallback(async (files: FileList | null) => {
        if (!files?.length) return;
        const newAttachments = await Promise.all(Array.from(files).map(fileToAttachment));
        setAttachments(prev => [...prev, ...newAttachments]);
    }, [fileToAttachment]);

    const removeAttachment = useCallback((id: string) => {
        setAttachments(prev => {
            const att = prev.find(a => a.id === id);
            if (att?.preview) URL.revokeObjectURL(att.preview);
            return prev.filter(a => a.id !== id);
        });
    }, []);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [gateway.messages, gateway.streamingContent]);

    // Auto-resize textarea
    const autoResize = useCallback(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
        }
    }, []);

    useEffect(() => { autoResize(); }, [input, autoResize]);

    // --- Send handler ---
    const handleSend = () => {
        if ((!input.trim() && !attachments.length)) return;
        const text = input.trim();
        const atts = attachments.length ? [...attachments] : undefined;
        setInput('');
        setAttachments([]);
        gateway.sendMessage(text, atts);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const inputDisabled = gateway.status === 'disconnected';
    const alexOnline = gateway.status === 'connected';
    const alexBusy = gateway.isStreaming || gateway.alexState === 'thinking' || gateway.alexState === 'executing';

    // --- Filter out noise messages (raw JSON, tool calls, system metadata) ---
    const isNoiseMessage = useCallback((msg: { role: string; content: string }) => {
        const c = msg.content.trim();
        if (!c) return true;
        if (msg.role === 'system') return true;
        if ((c.startsWith('{') && c.endsWith('}')) || (c.startsWith('[{') && c.endsWith('}]') && c.startsWith('[{"type"'))) {
            try { JSON.parse(c); return true; } catch { /* not JSON, show it */ }
        }
        if (c.startsWith('Successfully replaced text in ') || c.startsWith('Successfully edited ')) return false;
        return false;
    }, []);

    const filteredGatewayMessages = useMemo(
        () => gateway.messages.filter(msg => !isNoiseMessage(msg)),
        [gateway.messages, isNoiseMessage]
    );

    return (
        <div className="panel chat-panel chat-alex-mode">
            {/* Header */}
            <div className="chat-header">
                <div className="chat-mode-toggle">
                    <button className="chat-mode-btn active">
                        <span className={`gateway-dot ${alexOnline ? 'online' : 'offline'}`} />
                        <Zap size={13} />
                        Alex
                    </button>
                </div>

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
            </div>

            {/* Messages */}
            <div className="chat-messages">
                {filteredGatewayMessages.length === 0 && !gateway.isStreaming ? (
                    <p className="empty">
                        {alexOnline ? 'Talk to Alex…' : 'Connecting to Alex gateway…'}
                    </p>
                ) : (
                    <>
                        {filteredGatewayMessages.map((msg, i) => (
                            <MemoMessage key={i} msg={msg} />
                        ))}
                        {gateway.isStreaming && gateway.streamingContent && (
                            <div className="chat-message assistant alex streaming">
                                <div className="message-content markdown-body">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{gateway.streamingContent}</ReactMarkdown>
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
                        onPaste={handlePaste}
                        placeholder="Prata med Alex…"
                        disabled={inputDisabled}
                        className="bolt-textarea"
                        rows={1}
                    />

                    {/* Attachment preview strip */}
                    {attachments.length > 0 && (
                        <div className="attachment-strip">
                            {attachments.map(att => (
                                <div key={att.id} className={`attachment-chip ${att.preview ? 'has-preview' : ''}`}>
                                    {att.preview ? (
                                        <img src={att.preview} alt={att.name} className="attachment-thumb" />
                                    ) : (
                                        <>
                                            <FileIcon size={14} className="attachment-file-icon" />
                                            <span className="attachment-name">{att.name}</span>
                                            <span className="attachment-size">{(att.size / 1024).toFixed(0)}KB</span>
                                        </>
                                    )}
                                    <button className="attachment-remove" onClick={() => removeAttachment(att.id)} title="Ta bort bilaga">
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Hidden file inputs */}
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={e => { handleFilesSelected(e.target.files); e.target.value = ''; }}
                    />
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={e => { handleFilesSelected(e.target.files); e.target.value = ''; }}
                    />

                    <div className="bolt-toolbar">
                        <div className="bolt-toolbar-left">
                            <AttachMenu
                                onImageSelect={() => imageInputRef.current?.click()}
                                onFileSelect={() => fileInputRef.current?.click()}
                            />
                            <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
                        </div>

                        <div className="bolt-toolbar-right">
                            {alexBusy ? (
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
