import { supabase } from '../config/database';
import logger from '../config/logger';
import { auditService } from './audit-service';
import { AuthenticatedRequest, UserRole } from '../middleware/auth';

const VALID_ROLES: UserRole[] = ['owner', 'admin', 'member', 'viewer'];
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface RoleCacheEntry {
  role: UserRole;
  cachedAt: number;
}

class RoleService {
  private cache = new Map<string, RoleCacheEntry>();
  private auditService = auditService;

  /**
   * Get user role from authoritative source (database table)
   * Uses caching with TTL for performance
   */
  async getUserRole(userId: string): Promise<UserRole> {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && (Date.now() - cached.cachedAt) < ROLE_CACHE_TTL_MS) {
      return cached.role;
    }

    try {
      // Query the authoritative source
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        logger.error('Error fetching user role:', { userId, error });
        throw new Error('Failed to fetch user role');
      }

      const role: UserRole = data?.role || 'member';

      // Validate role is in allowed set
      if (!VALID_ROLES.includes(role)) {
        logger.warn('Invalid role found in database, defaulting to member:', { userId, role });
        return 'member';
      }

      // Cache the result
      this.cache.set(userId, { role, cachedAt: Date.now() });

      return role;
    } catch (error) {
      logger.error('RoleService.getUserRole error:', { userId, error });
      // Return default role on error to avoid breaking auth
      return 'member';
    }
  }

  /**
   * Set user role (admin/owner only)
   */
  async setUserRole(
    userId: string,
    role: UserRole,
    assignedBy: string,
    req?: AuthenticatedRequest
  ): Promise<{ success: boolean; error?: string }> {
    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return { success: false, error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` };
    }

    try {
      const { error } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          role,
          assigned_by: assignedBy,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        logger.error('Error setting user role:', { userId, role, assignedBy, error });
        return { success: false, error: 'Failed to update user role' };
      }

      // Clear cache for this user
      this.cache.delete(userId);

      // Audit log the role change
      await this.auditService.insertEntry({
        userId: assignedBy,
        action: 'role_assigned',
        resourceType: 'user_role',
        resourceId: userId,
        metadata: {
          newRole: role,
          previousRole: req?.user?.role,
        },
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
      });

      logger.info('User role updated:', { userId, role, assignedBy });
      return { success: true };
    } catch (error) {
      logger.error('RoleService.setUserRole error:', { userId, role, assignedBy, error });
      return { success: false, error: 'Failed to set user role' };
    }
  }

  /**
   * Check if user has required role(s)
   * Logs audit entry for forbidden attempts
   */
  async requireRole(
    userId: string,
    requiredRoles: UserRole[],
    req?: AuthenticatedRequest
  ): Promise<{ allowed: boolean; userRole?: UserRole }> {
    const userRole = await this.getUserRole(userId);

    const allowed = requiredRoles.includes(userRole);

    if (!allowed) {
      // Audit log forbidden role attempt
      await this.auditService.insertEntry({
        userId,
        action: 'role_forbidden',
        resourceType: 'authorization',
        metadata: {
          requiredRoles,
          userRole,
          endpoint: req?.originalUrl,
          method: req?.method,
        },
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
      });

      logger.warn('Role authorization failed:', {
        userId,
        userRole,
        requiredRoles,
        endpoint: req?.originalUrl,
        method: req?.method,
      });
    }

    return { allowed, userRole };
  }

  /**
   * Clear role cache for a user (useful after role changes)
   */
  clearUserCache(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Clear all role cache (useful for maintenance)
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats for monitoring
   */
  getCacheStats(): { size: number; entries: Array<{ userId: string; role: UserRole; age: number }> } {
    const entries = Array.from(this.cache.entries()).map(([userId, entry]) => ({
      userId,
      role: entry.role,
      age: Date.now() - entry.cachedAt,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}

export const roleService = new RoleService();
export default roleService;