import { Response, NextFunction } from 'express';
import { supabase } from '../config/database';
import { AuthenticatedRequest, UserRole } from './auth';
import logger from '../config/logger';

export type TeamRole = 'owner' | 'operator' | 'viewer';

/**
 * Team-scoped authorization context
 * Provides the user's role within their team and enforces the v3
 * principal-agent authorization model.
 */
export interface TeamAuthContext {
  teamId: string;
  teamRole: TeamRole;
  isOwner: boolean;
  isOperator: boolean;
  isViewer: boolean;
}

/**
 * Resolve the user's team role from the database.
 * Returns null if the user is not part of any team.
 */
export async function resolveTeamAuth(
  userId: string
): Promise<TeamAuthContext | null> {
  // Check if user owns a team
  const { data: ownedTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  if (ownedTeam) {
    return {
      teamId: ownedTeam.id,
      teamRole: 'owner',
      isOwner: true,
      isOperator: false,
      isViewer: false,
    };
  }

  // Check if user is a team member
  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (membership) {
    const role = membership.role as TeamRole;
    return {
      teamId: membership.team_id,
      teamRole: role,
      isOwner: false,
      isOperator: role === 'operator',
      isViewer: role === 'viewer',
    };
  }

  return null;
}

/**
 * Middleware that attaches team authorization context to the request.
 * Must be used after the `authenticate` middleware.
 * 
 * Populates `req.teamAuth` with the user's team context.
 */
export async function attachTeamAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  const teamAuth = await resolveTeamAuth(req.user.id);
  if (!teamAuth) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'User is not a member of any team',
    });
    return;
  }

  // Attach team auth context to request
  (req as AuthenticatedRequest & { teamAuth: TeamAuthContext }).teamAuth = teamAuth;
  next();
}

/**
 * Middleware that enforces team role requirements.
 * Must be used after `attachTeamAuth` middleware.
 * 
 * @param roles - Required team roles (one of which the user must have)
 */
export function requireTeamRole(...roles: TeamRole[]) {
  return (req: AuthenticatedRequest & { teamAuth?: TeamAuthContext }, res: Response, next: NextFunction): void => {
    const teamAuth = (req as any).teamAuth as TeamAuthContext | undefined;
    
    if (!teamAuth) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Team authorization required',
      });
      return;
    }

    if (!roles.includes(teamAuth.teamRole)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following team roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware that enforces owner-only actions for money-moving operations.
 * These actions require:
 * 1. Owner team role
 * 2. MFA re-authentication (checked via requireMfaReauth middleware)
 */
export function requireOwnerMfa() {
  return (req: AuthenticatedRequest & { teamAuth?: TeamAuthContext }, res: Response, next: NextFunction): void => {
    const teamAuth = (req as any).teamAuth as TeamAuthContext | undefined;
    
    if (!teamAuth || !teamAuth.isOwner) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners can perform this action',
      });
      return;
    }

    // Check for MFA re-authentication flag (set by requireMfaReauth middleware)
    const mfaVerified = (req as any).mfaVerified;
    if (!mfaVerified) {
      res.status(403).json({
        error: 'MFA Required',
        message: 'Re-authentication via MFA is required for this action. Please verify your TOTP code at /api/2fa/totp/verify first.',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware that checks if the user has recently verified MFA.
 * This can be used in combination with other middlewares.
 * 
 * The MFA verification can be provided via:
 * - Header `x-mfa-verified: true` (set after successful TOTP verification)
 * - Query parameter `mfa_verified=true`
 * - Session/cookie (if implemented)
 */
export function requireMfaReauth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Check for MFA verification flag
  const mfaVerified = req.headers['x-mfa-verified'] === 'true' 
    || req.query.mfa_verified === 'true';
  
  if (!mfaVerified) {
    res.status(403).json({
      error: 'MFA Required',
      message: 'This action requires MFA re-authentication. Please verify your TOTP code at /api/2fa/totp/verify first.',
    });
    return;
  }

  // Attach MFA verified flag for subsequent middleware
  (req as any).mfaVerified = true;
  next();
}

/**
 * Check if a team role can perform a specific action.
 * This implements the v3 role matrix.
 */
export function canTeamRolePerformAction(role: TeamRole, action: string): boolean {
  const permissions: Record<TeamRole, string[]> = {
    owner: [
      'fund_channels',
      'grant_authority',
      'raise_cap',
      'change_payout',
      'close_channel',
      'register_agents',
      'read_usage',
      'invite_members',
      'remove_members',
      'update_roles',
      'manage_webhooks',
    ],
    operator: [
      'register_agents',
      'read_usage',
      'view_team',
    ],
    viewer: [
      'read_usage',
      'view_team',
    ],
  };

  return permissions[role]?.includes(action) ?? false;
}