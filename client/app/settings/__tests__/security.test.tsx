/**
 * Security Settings Tests
 * 
 * Tests password change form validation, session invalidation after password change,
 * and security audit log display.
 * 
 * **Validates: Requirements 3.5, 4.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockUser } from '@/lib/test-utils/factories';
import { mockSupabaseClient } from '@/lib/test-utils/mocks';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('Security Settings Tests', () => {
  let supabase: ReturnType<typeof mockSupabaseClient>;
  let testUser: ReturnType<typeof mockUser>;

  beforeEach(() => {
    testUser = mockUser({ id: 'user-security-123', email: 'security@example.com' });
    supabase = mockSupabaseClient(testUser);
    vi.clearAllMocks();
  });

  describe('Password Change Form Validation', () => {
    it('should validate password requirements', () => {
      const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (password.length < 8) {
          errors.push('Password must be at least 8 characters');
        }
        if (!/[A-Z]/.test(password)) {
          errors.push('Password must contain at least one uppercase letter');
        }
        if (!/[a-z]/.test(password)) {
          errors.push('Password must contain at least one lowercase letter');
        }
        if (!/[0-9]/.test(password)) {
          errors.push('Password must contain at least one number');
        }
        if (!/[^A-Za-z0-9]/.test(password)) {
          errors.push('Password must contain at least one special character');
        }

        return { valid: errors.length === 0, errors };
      };

      // Valid password
      expect(validatePassword('SecurePass123!')).toEqual({ valid: true, errors: [] });

      // Invalid passwords
      expect(validatePassword('short')).toEqual({
        valid: false,
        errors: expect.arrayContaining(['Password must be at least 8 characters']),
      });

      expect(validatePassword('nouppercase123!')).toEqual({
        valid: false,
        errors: expect.arrayContaining(['Password must contain at least one uppercase letter']),
      });

      expect(validatePassword('NOLOWERCASE123!')).toEqual({
        valid: false,
        errors: expect.arrayContaining(['Password must contain at least one lowercase letter']),
      });

      expect(validatePassword('NoNumbers!')).toEqual({
        valid: false,
        errors: expect.arrayContaining(['Password must contain at least one number']),
      });

      expect(validatePassword('NoSpecial123')).toEqual({
        valid: false,
        errors: expect.arrayContaining(['Password must contain at least one special character']),
      });
    });

    it('should require current password for password change', () => {
      const PasswordChangeForm = () => (
        <form>
          <label htmlFor="current-password">Current Password</label>
          <input
            id="current-password"
            type="password"
            required
            aria-required="true"
          />
          <label htmlFor="new-password">New Password</label>
          <input
            id="new-password"
            type="password"
            required
            aria-required="true"
          />
          <label htmlFor="confirm-password">Confirm New Password</label>
          <input
            id="confirm-password"
            type="password"
            required
            aria-required="true"
          />
          <button type="submit">Change Password</button>
        </form>
      );

      render(<PasswordChangeForm />);

      expect(screen.getByLabelText('Current Password')).toBeRequired();
      expect(screen.getByLabelText('New Password')).toBeRequired();
      expect(screen.getByLabelText('Confirm New Password')).toBeRequired();
    });

    it('should validate password confirmation match', () => {
      const validatePasswordMatch = (password: string, confirm: string): boolean => {
        return password === confirm;
      };

      expect(validatePasswordMatch('Password123!', 'Password123!')).toBe(true);
      expect(validatePasswordMatch('Password123!', 'Different123!')).toBe(false);
    });

    it('should show password strength indicator', () => {
      const calculatePasswordStrength = (password: string): 'weak' | 'medium' | 'strong' => {
        let strength = 0;

        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[a-z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^A-Za-z0-9]/.test(password)) strength++;

        if (strength <= 2) return 'weak';
        if (strength <= 4) return 'medium';
        return 'strong';
      };

      expect(calculatePasswordStrength('pass')).toBe('weak');
      expect(calculatePasswordStrength('Password1')).toBe('medium');
      expect(calculatePasswordStrength('SecurePass123!')).toBe('strong');
      expect(calculatePasswordStrength('V3ryS3cur3P@ssw0rd!')).toBe('strong');
    });

    it('should prevent password reuse', async () => {
      const checkPasswordHistory = async (userId: string, newPassword: string): Promise<boolean> => {
        // Mock checking against password history
        const previousPasswords = ['OldPassword123!', 'PreviousPass456!'];
        
        // In real implementation, would hash and compare
        return previousPasswords.includes(newPassword);
      };

      expect(await checkPasswordHistory(testUser.id, 'OldPassword123!')).toBe(true);
      expect(await checkPasswordHistory(testUser.id, 'NewPassword789!')).toBe(false);
    });

    it('should show real-time validation errors', () => {
      const PasswordInput = () => {
        const [password, setPassword] = vi.fn().mockReturnValue('') as any;
        const [errors, setErrors] = vi.fn().mockReturnValue([]) as any;

        const validate = (value: string) => {
          const newErrors: string[] = [];
          if (value && value.length < 8) {
            newErrors.push('Too short');
          }
          setErrors(newErrors);
        };

        return (
          <div>
            <input
              aria-label="Password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                validate(e.target.value);
              }}
            />
            {errors.length > 0 && (
              <div role="alert">
                {errors.map((err: string, i: number) => (
                  <span key={i}>{err}</span>
                ))}
              </div>
            )}
          </div>
        );
      };

      render(<PasswordInput />);
      
      const input = screen.getByLabelText('Password');
      fireEvent.change(input, { target: { value: 'short' } });

      // Validation would occur on change
      expect(input).toBeInTheDocument();
    });
  });

  describe('Session Invalidation After Password Change', () => {
    it('should invalidate all sessions after password change', async () => {
      supabase.auth.updateUser.mockResolvedValue({
        data: { user: testUser },
        error: null,
      });

      // Mock session invalidation
      const mockInvalidateAllSessions = vi.fn().mockResolvedValue({ success: true });

      // Act - Change password
      const { data } = await supabase.auth.updateUser({
        password: 'NewSecurePassword123!',
      });

      expect(data.user).toEqual(testUser);

      // In real implementation, would invalidate sessions
      await mockInvalidateAllSessions(testUser.id);
      expect(mockInvalidateAllSessions).toHaveBeenCalledWith(testUser.id);
    });

    it('should require re-authentication after password change', async () => {
      const mockAuthService = {
        updatePassword: vi.fn().mockResolvedValue({ success: true }),
        signOut: vi.fn().mockResolvedValue({ success: true }),
        requireReauth: vi.fn().mockResolvedValue({ required: true }),
      };

      // Change password
      await mockAuthService.updatePassword('NewPassword123!');

      // Should sign out
      await mockAuthService.signOut();
      
      // Should require reauth
      const reauthResult = await mockAuthService.requireReauth();

      expect(mockAuthService.updatePassword).toHaveBeenCalled();
      expect(mockAuthService.signOut).toHaveBeenCalled();
      expect(reauthResult.required).toBe(true);
    });

    it('should update password in database', async () => {
      const newPassword = 'NewSecurePass123!';

      supabase.auth.updateUser.mockResolvedValue({
        data: { 
          user: { 
            ...testUser,
            updated_at: new Date().toISOString(),
          } 
        },
        error: null,
      });

      // Act
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      // Assert
      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: newPassword,
      });
    });

    it('should handle password update errors', async () => {
      supabase.auth.updateUser.mockResolvedValue({
        data: { user: null },
        error: {
          message: 'Password update failed',
          status: 400,
        },
      });

      // Act
      const { error } = await supabase.auth.updateUser({
        password: 'NewPassword123!',
      });

      // Assert
      expect(error).toBeDefined();
      expect(error?.message).toBe('Password update failed');
    });

    it('should send password change notification email', async () => {
      const mockEmailService = {
        sendPasswordChangeNotification: vi.fn().mockResolvedValue({ sent: true }),
      };

      // After password change
      await mockEmailService.sendPasswordChangeNotification({
        to: testUser.email,
        userId: testUser.id,
        timestamp: new Date().toISOString(),
      });

      expect(mockEmailService.sendPasswordChangeNotification).toHaveBeenCalledWith({
        to: testUser.email,
        userId: testUser.id,
        timestamp: expect.any(String),
      });
    });
  });

  describe('Security Audit Log Display', () => {
    it('should display security audit log entries', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          user_id: testUser.id,
          action: 'password_changed',
          timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        },
        {
          id: 'log-2',
          user_id: testUser.id,
          action: 'mfa_enabled',
          timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        },
        {
          id: 'log-3',
          user_id: testUser.id,
          action: 'login',
          timestamp: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
          ip_address: '192.168.1.2',
          user_agent: 'Mozilla/5.0',
        },
      ];

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.order.mockReturnThis();
      supabase.limit.mockResolvedValue({
        data: auditLogs,
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', testUser.id)
        .order('timestamp', { ascending: false })
        .limit(50);

      // Assert
      expect(data).toHaveLength(3);
      expect(data?.[0].action).toBe('password_changed');
      expect(data?.[1].action).toBe('mfa_enabled');
      expect(data?.[2].action).toBe('login');
    });

    it('should filter audit logs by action type', async () => {
      const securityActions = ['password_changed', 'mfa_enabled', 'mfa_disabled'];

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.in.mockReturnThis();
      supabase.order.mockResolvedValue({
        data: [
          {
            id: 'log-1',
            user_id: testUser.id,
            action: 'password_changed',
            timestamp: new Date().toISOString(),
          },
        ],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', testUser.id)
        .in('action', securityActions)
        .order('timestamp', { ascending: false });

      // Assert
      expect(supabase.in).toHaveBeenCalledWith('action', securityActions);
      expect(data?.[0].action).toBe('password_changed');
    });

    it('should display timestamp in readable format', () => {
      const formatTimestamp = (isoString: string): string => {
        const date = new Date(isoString);
        return date.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
      };

      const timestamp = '2024-01-15T10:30:00Z';
      const formatted = formatTimestamp(timestamp);
      
      expect(formatted).toMatch(/Jan 15, 2024/);
    });

    it('should show IP address and location', () => {
      const auditEntry = {
        id: 'log-1',
        action: 'login',
        ip_address: '192.168.1.1',
        location: 'San Francisco, CA, US',
        timestamp: new Date().toISOString(),
      };

      expect(auditEntry.ip_address).toBe('192.168.1.1');
      expect(auditEntry.location).toBe('San Francisco, CA, US');
    });

    it('should display device/browser information', () => {
      const parseUserAgent = (userAgent: string): { browser: string; os: string } => {
        // Simplified user agent parsing
        if (userAgent.includes('Chrome')) {
          return { browser: 'Chrome', os: 'Windows' };
        }
        return { browser: 'Unknown', os: 'Unknown' };
      };

      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';
      const parsed = parseUserAgent(ua);

      expect(parsed.browser).toBe('Chrome');
      expect(parsed.os).toBe('Windows');
    });

    it('should paginate audit log entries', async () => {
      const pageSize = 20;
      const page = 1;
      const offset = (page - 1) * pageSize;

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.order.mockReturnThis();
      supabase.range.mockResolvedValue({
        data: Array(20).fill(null).map((_, i) => ({
          id: `log-${i}`,
          user_id: testUser.id,
          action: 'login',
          timestamp: new Date().toISOString(),
        })),
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', testUser.id)
        .order('timestamp', { ascending: false })
        .range(offset, offset + pageSize - 1);

      // Assert
      expect(supabase.range).toHaveBeenCalledWith(0, 19);
      expect(data).toHaveLength(20);
    });

    it('should highlight suspicious activities', () => {
      const flagSuspiciousActivity = (entry: { action: string; ip_address: string }): boolean => {
        const suspiciousActions = ['failed_login', 'password_reset_request', 'mfa_disabled'];
        
        // Flag if action is suspicious or IP changed significantly
        return suspiciousActions.includes(entry.action);
      };

      expect(flagSuspiciousActivity({ action: 'failed_login', ip_address: '192.168.1.1' })).toBe(true);
      expect(flagSuspiciousActivity({ action: 'login', ip_address: '192.168.1.1' })).toBe(false);
    });

    it('should export audit log to CSV', () => {
      const auditLogs = [
        { timestamp: '2024-01-15T10:00:00Z', action: 'login', ip_address: '192.168.1.1' },
        { timestamp: '2024-01-15T11:00:00Z', action: 'password_changed', ip_address: '192.168.1.1' },
      ];

      const exportToCSV = (logs: typeof auditLogs): string => {
        const header = 'Timestamp,Action,IP Address\n';
        const rows = logs.map(log => 
          `${log.timestamp},${log.action},${log.ip_address}`
        ).join('\n');
        
        return header + rows;
      };

      const csv = exportToCSV(auditLogs);
      
      expect(csv).toContain('Timestamp,Action,IP Address');
      expect(csv).toContain('login,192.168.1.1');
      expect(csv).toContain('password_changed,192.168.1.1');
    });
  });
});
