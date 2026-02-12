import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Request ID Middleware
 * Attaches a unique request ID to each incoming request for tracking
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Use existing request ID from headers or generate new one
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  
  // Attach to request object
  req.requestId = requestId;
  
  // Add to response headers for client tracking
  res.setHeader('X-Request-Id', requestId);
  
  next();
};

export default requestIdMiddleware;
