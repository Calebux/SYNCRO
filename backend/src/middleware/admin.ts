import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { env } from '../config/env';
import { requireRole } from './rbac';

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-admin-api-key'];
    if (!apiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Admin API key required',
        });
    }
    if (apiKey !== env.ADMIN_API_KEY) {
        logger.warn(`Forbidden admin access attempt from IP: ${req.ip}`);
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid admin API key',
        });
    }
    next();
};

/** JWT role gate for user-facing admin operations (requires authenticate first). */
export const requireAdmin = requireRole('owner', 'admin');
