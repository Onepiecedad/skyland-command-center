import { useState, useCallback, useEffect } from 'react';
import type { ChatResponse, Task } from '../api';
import { sendChatMessage, sendAlexMessage } from '../api';

type ChatMode = 'masterbrain' | 'alex';

interface Props {
    onTaskCreated: () => void;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    intent?: string;
    proposedActions?: Array<{ type: string; task_id?: string; task?: Task }>;
    suggestions?: string[];
}

export function MasterBrainChat({ onTaskCreated }: Props) {
    const [chatMode, setChatMode] = useState<ChatMode>('masterbrain');
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [alexOnline, setAlexOnline] = useState<boolean | null>(null);

    // Separate state per mode
    const [mbMessages, setMbMessages] = useState<ChatMessage[]>([]);
    const [alexMessages, setAlexMessages] = useState<ChatMessage[]>([]);
    const [mbConvoId, setMbConvoId] = useState<string | null>(null);
    const [alexConvoId, setAlexConvoId] = useState<string | null>(null);

    const messages = chatMode === 'masterbrain' ? mbMessages : alexMessages;
    const setMessages = chatMode === 'masterbrain' ? setMbMessages : setAlexMessages;

    // Check Alex gateway
    const checkAlexGateway = useCallback(async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('http://localhost:18789/health', { signal: controller.signal });
            clearTimeout(timeout);
            setAlexOnline(res.ok);
        } catch {
            setAlexOnline(false);
        }
    }, []);

    useEffect(() => {
        // Initial check + polling
        const id = setTimeout(checkAlexGateway, 0);
        const interval = setInterval(checkAlexGateway, 30000);
        return () => { clearTimeout(id); clearInterval(interval); };
    }, [checkAlexGateway]);

    const handleSend = async () => {
        if (!input.trim() || sending) return;

        const userMessage = input.trim();
        setInput('');
        setSending(true);

        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        try {
            if (chatMode === 'masterbrain') {
                const response: ChatResponse = await sendChatMessage(userMessage, mbConvoId || undefined);
                setMbConvoId(response.conversation_id);
                setMbMessages(prev => [...prev, {
                    role: 'assistant',
                    content: response.response,
                    intent: response.intent,
                    proposedActions: response.proposed_actions,
                    suggestions: response.suggestions
                }]);
                if (response.intent === 'CREATE_TASK' && response.proposed_actions.length > 0) {
                    onTaskCreated();
                }
            } else {
                const response = await sendAlexMessage(userMessage, alexConvoId || undefined);
                if (response.conversation_id) setAlexConvoId(response.conversation_id);
                setAlexMessages(prev => [...prev, {
                    role: 'assistant',
                    content: response.response
                }]);
            }
        } catch (err) {
            console.error('Chat error:', err);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: chatMode === 'alex'
                    ? 'Error: Could not reach Alex gateway'
                    : 'Error: Could not send message'
            }]);
        }

        setSending(false);
    };

    const handleSuggestionClick = (suggestion: string) => {
        setInput(suggestion);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className={`panel chat-panel ${chatMode === 'alex' ? 'chat-alex-mode' : ''}`}>
            <div className="chat-header">
                <div className="chat-mode-toggle">
                    <button
                        className={`chat-mode-btn ${chatMode === 'masterbrain' ? 'active' : ''}`}
                        onClick={() => setChatMode('masterbrain')}
                    >
                        🧠 MasterBrain
                    </button>
                    <button
                        className={`chat-mode-btn ${chatMode === 'alex' ? 'active' : ''}`}
                        onClick={() => setChatMode('alex')}
                    >
                        <span className={`gateway-dot ${alexOnline ? 'online' : alexOnline === false ? 'offline' : ''}`} />
                        🤖 Alex
                    </button>
                </div>
            </div>

            <div className="chat-messages">
                {messages.length === 0 ? (
                    <p className="empty">
                        {chatMode === 'alex'
                            ? (alexOnline ? 'Talk to Alex...' : 'Alex gateway is offline')
                            : 'Start a conversation...'}
                    </p>
                ) : (
                    messages.map((msg, i) => (
                        <div key={i} className={`chat-message ${msg.role} ${chatMode === 'alex' && msg.role === 'assistant' ? 'alex' : ''}`}>
                            <div className="message-content">{msg.content}</div>

                            {msg.intent && (
                                <span className="intent-badge">{msg.intent}</span>
                            )}

                            {msg.proposedActions && msg.proposedActions.length > 0 && (
                                <div className="proposed-actions">
                                    {msg.proposedActions.map((action, j) => (
                                        <div key={j} className="proposed-action">
                                            📋 {action.type}: {action.task?.title || action.task_id}
                                            {action.task && (
                                                <span className="task-status"> (status: {action.task.status})</span>
                                            )}
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
                                            onClick={() => handleSuggestionClick(s)}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <div className="chat-input">
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={chatMode === 'alex' ? 'Talk to Alex...' : 'Ask Master Brain...'}
                    disabled={sending || (chatMode === 'alex' && alexOnline === false)}
                />
                <button onClick={handleSend} disabled={sending || !input.trim()}>
                    {sending ? '...' : 'Send'}
                </button>
            </div>

            {chatMode === 'masterbrain' && mbConvoId && (
                <div className="conversation-id">
                    Conversation: {mbConvoId.slice(0, 8)}...
                </div>
            )}
        </div>
    );
}
