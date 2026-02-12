// ============================================================================
// Chat API — Alex gateway communication
// ============================================================================
import { GATEWAY_HTTP } from '../config';

export async function sendAlexMessage(message: string, conversationId?: string): Promise<{
    response: string;
    conversation_id?: string;
}> {
    const res = await fetch(`${GATEWAY_HTTP}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation_id: conversationId }),
    });
    if (!res.ok) throw new Error(`Alex gateway error: ${res.status}`);
    return res.json();
}
