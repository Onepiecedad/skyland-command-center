import { useState } from 'react';
import type { ChatResponse, Task } from '../api';
import { sendChatMessage } from '../api';

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
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const handleSend = async () => {
        if (!input.trim() || sending) return;

        const userMessage = input.trim();
        setInput('');
        setSending(true);

        // Add user message immediately
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        try {
            const response: ChatResponse = await sendChatMessage(userMessage, conversationId || undefined);

            // Save conversation_id for continuity
            setConversationId(response.conversation_id);

            // Add assistant response
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: response.response,
                intent: response.intent,
                proposedActions: response.proposed_actions,
                suggestions: response.suggestions
            }]);

            // If task was created, notify parent to refresh
            if (response.intent === 'CREATE_TASK' && response.proposed_actions.length > 0) {
                onTaskCreated();
            }
        } catch (err) {
            console.error('Chat error:', err);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Error: Could not send message'
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
        <div className="panel chat-panel">
            <h2>🧠 Master Brain Chat</h2>

            <div className="chat-messages">
                {messages.length === 0 ? (
                    <p className="empty">Start a conversation...</p>
                ) : (
                    messages.map((msg, i) => (
                        <div key={i} className={`chat-message ${msg.role}`}>
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
                    onKeyPress={handleKeyPress}
                    placeholder="Ask Master Brain..."
                    disabled={sending}
                />
                <button onClick={handleSend} disabled={sending || !input.trim()}>
                    {sending ? '...' : 'Send'}
                </button>
            </div>

            {conversationId && (
                <div className="conversation-id">
                    Conversation: {conversationId.slice(0, 8)}...
                </div>
            )}
        </div>
    );
}
