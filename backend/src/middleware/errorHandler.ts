import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { ApiResponse } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Custom API Error class
 */
export class AppError extends Error {
  public status: number;
  public code: string;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found Error Handler
 * Catches 404 errors for undefined routes
 */
export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const error = new AppError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
};

/**
 * Global Error Handler
 * Centralized error handling middleware
 */
export const errorHandler = (
  err: Error | AppError | ZodError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = req.requestId || 'unknown';
  
  // Default error values
  let status = 500;
  let message = 'Internal Server Error';
  let code = 'INTERNAL_ERROR';
  let details: Record<string, unknown> | undefined;

  // Handle different error types
  if (err instanceof AppError) {
    status = err.status;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Validation Error';
    code = 'VALIDATION_ERROR';
    details = {
      issues: err.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }))
    };
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized';
    code = 'UNAUTHORIZED';
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    status = 400;
    message = 'Invalid JSON body';
    code = 'INVALID_JSON';
  }

  // Log error with context
  const logLevel = status >= 500 ? 'error' : 'warn';
  logger[logLevel]({
    message: err.message,
    requestId,
    status,
    code,
    stack: err.stack,
    path: req.path,
    method: req.method,
    details
  });

  // Send standardized error response
  const errorResponse: ApiResponse<never> = {
    success: false,
    error: {
      status,
      message,
      code,
      details,
      requestId
    },
    requestId,
    timestamp: new Date().toISOString()
  };

  res.status(status).json(errorResponse);
};

/**
 * Async handler wrapper
 * Wraps async route handlers to catch errors automatically
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default errorHandler;
