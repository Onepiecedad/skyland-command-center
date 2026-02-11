import { z } from 'zod';

export const chatRequestSchema = z.object({
    message: z.string().min(1),
    customer_id: z.string().uuid().optional(),
    channel: z.enum(['chat', 'voice', 'email', 'sms', 'whatsapp', 'webhook']).default('chat'),
    conversation_id: z.string().uuid().optional()
});
