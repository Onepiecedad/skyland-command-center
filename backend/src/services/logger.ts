/**
 * Structured JSON Logger
 * Fas 7.3 — Replaces console.log/error with structured JSON-lines
 *
 * Usage:
 *   import { logger } from '../services/logger';
 *   logger.info('chat', 'Tool call executed', { tool: 'get_customer_status' });
 *
 * Output:
 *   {"ts":"2026-02-12T00:30:00.000Z","level":"info","ctx":"chat","msg":"Tool call executed","data":{"tool":"get_customer_status"}}
 */

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
    ts: string;
    level: LogLevel;
    ctx: string;
    msg: string;
    data?: unknown;
}

function emit(level: LogLevel, ctx: string, msg: string, data?: unknown): void {
    const entry: LogEntry = {
        ts: new Date().toISOString(),
        level,
        ctx,
        msg,
    };
    if (data !== undefined) {
        entry.data = data;
    }

    const line = JSON.stringify(entry);

    if (level === 'error') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

export const logger = {
    info(ctx: string, msg: string, data?: unknown): void {
        emit('info', ctx, msg, data);
    },
    warn(ctx: string, msg: string, data?: unknown): void {
        emit('warn', ctx, msg, data);
    },
    error(ctx: string, msg: string, data?: unknown): void {
        emit('error', ctx, msg, data);
    },
};
