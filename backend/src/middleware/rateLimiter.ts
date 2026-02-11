import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter — 100 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Chat-specific limiter — 10 requests per minute per IP.
 */
export const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Chat rate limit exceeded. Please wait before sending more messages.' },
});

/**
 * Admin-specific limiter — 30 requests per minute per IP.
 */
export const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Admin rate limit exceeded.' },
});
