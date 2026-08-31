import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UserRole } from './auth';

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  owner: ['*'],
  admin: ['subscriptions:*', 'team:read', 'team:write', 'billing:read'],
  member: ['subscriptions:read', 'subscriptions:create'],
  viewer: ['subscriptions:read'],
};

/**
 * Middleware that restricts a route to users with one of the specified roles.
 * Must be used after the `authenticate` middleware.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
