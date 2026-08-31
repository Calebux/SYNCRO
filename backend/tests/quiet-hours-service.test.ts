import { QuietHoursService } from '../src/services/quiet-hours-service';
import { UserPreferences, NotificationPayload } from '../src/types/reminder';

describe('QuietHoursService', () => {
  let service: QuietHoursService;
  
  beforeEach(() => {
    service = new QuietHoursService();
  });

  const mockUserPreferences: UserPreferences = {
    user_id: 'test-user',
    notification_channels: ['email'],
    reminder_timing: [7, 3, 1],
    email_opt_ins: {
      marketing: false,
      reminders: true,
      updates: true,
    },
    automation_flags: {
      auto_renew: false,
      auto_retry: true,
    },
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    quiet_hours_timezone: 'UTC',
    critical_alerts_only: true,
    updated_at: new Date().toISOString(),
  };

  const mockNotificationPayload: NotificationPayload = {
    title: 'Test Notification',
    body: 'Test notification body',
    subscription: {
      id: 'test-sub',
      name: 'Test Service',
      provider: 'Test Provider',
    } as any,
    reminderType: 'renewal',
    daysBefore: 7,
    renewalDate: new Date().toISOString(),
  };

  describe('isInQuietHours', () => {
    it('should return true when current time is within quiet hours (overnight)', () => {
      // Test at 11 PM (23:00) - should be in quiet hours
      const testTime = new Date('2024-01-01T23:00:00Z');
      const result = service.isInQuietHours(mockUserPreferences, testTime);
      expect(result).toBe(true);
    });

    it('should return true when current time is within quiet hours (early morning)', () => {
      // Test at 6 AM (06:00) - should be in quiet hours
      const testTime = new Date('2024-01-01T06:00:00Z');
      const result = service.isInQuietHours(mockUserPreferences, testTime);
      expect(result).toBe(true);
    });

    it('should return false when current time is outside quiet hours', () => {
      // Test at 10 AM (10:00) - should not be in quiet hours
      const testTime = new Date('2024-01-01T10:00:00Z');
      const result = service.isInQuietHours(mockUserPreferences, testTime);
      expect(result).toBe(false);
    });

    it('should return false when quiet hours are disabled', () => {
      const disabledPrefs = { ...mockUserPreferences, quiet_hours_enabled: false };
      const testTime = new Date('2024-01-01T23:00:00Z');
      const result = service.isInQuietHours(disabledPrefs, testTime);
      expect(result).toBe(false);
    });
  });

  describe('determineNotificationPriority', () => {
    it('should classify final day renewal as critical', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 1 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('critical');
    });

    it('should classify trial expiring today as critical', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'trial_expiry' as const, daysBefore: 0 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('critical');
    });

    it('should classify trial expiring within 2 days as high', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'trial_expiry' as const, daysBefore: 2 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('high');
    });

    it('should classify renewal within 3 days as high', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 3 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('high');
    });

    it('should classify standard renewal as normal', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 7 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('normal');
    });

    it('should classify cancellation reminders as low', () => {
      const payload = { ...mockNotificationPayload, reminderType: 'cancellation' as const, daysBefore: 1 };
      const priority = service.determineNotificationPriority(payload);
      expect(priority).toBe('low');
    });
  });

  describe('shouldSendDuringQuietHours', () => {
    it('should allow critical alerts during quiet hours', () => {
      const criticalPayload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 1 };
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM - in quiet hours
      
      const result = service.shouldSendDuringQuietHours(mockUserPreferences, criticalPayload, testTime);
      
      expect(result.isQuietHours).toBe(true);
      expect(result.shouldDelay).toBe(false);
      expect(result.reason).toContain('Critical alert allowed');
    });

    it('should delay non-critical alerts during quiet hours when critical_alerts_only is true', () => {
      const normalPayload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 7 };
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM - in quiet hours
      
      const result = service.shouldSendDuringQuietHours(mockUserPreferences, normalPayload, testTime);
      
      expect(result.isQuietHours).toBe(true);
      expect(result.shouldDelay).toBe(true);
      expect(result.delayUntil).toBeDefined();
      expect(result.reason).toContain('Non-critical alert delayed');
    });

    it('should allow all alerts during quiet hours when critical_alerts_only is false', () => {
      const allowAllPrefs = { ...mockUserPreferences, critical_alerts_only: false };
      const normalPayload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 7 };
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM - in quiet hours
      
      const result = service.shouldSendDuringQuietHours(allowAllPrefs, normalPayload, testTime);
      
      expect(result.isQuietHours).toBe(true);
      expect(result.shouldDelay).toBe(false);
      expect(result.reason).toContain('User allows all alerts');
    });

    it('should not delay alerts when not in quiet hours', () => {
      const normalPayload = { ...mockNotificationPayload, reminderType: 'renewal' as const, daysBefore: 7 };
      const testTime = new Date('2024-01-01T10:00:00Z'); // 10 AM - not in quiet hours
      
      const result = service.shouldSendDuringQuietHours(mockUserPreferences, normalPayload, testTime);
      
      expect(result.isQuietHours).toBe(false);
      expect(result.shouldDelay).toBe(false);
    });
  });

  describe('getQuietHoursEndTime', () => {
    it('should calculate correct end time for overnight quiet hours', () => {
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM
      const endTime = service.getQuietHoursEndTime(mockUserPreferences, testTime);
      
      // Should be 8 AM the next day
      expect(endTime.getUTCHours()).toBe(8);
      expect(endTime.getUTCDate()).toBe(2); // Next day
    });

    it('should calculate correct end time when current time is before end time', () => {
      const testTime = new Date('2024-01-01T06:00:00Z'); // 6 AM
      const endTime = service.getQuietHoursEndTime(mockUserPreferences, testTime);
      
      // Should be 8 AM the same day
      expect(endTime.getUTCHours()).toBe(8);
      expect(endTime.getUTCDate()).toBe(1); // Same day
    });
  });

  describe('isAppropriateTimeForDelayedNotifications', () => {
    it('should return true during appropriate hours (8 AM - 10 PM)', () => {
      const testTime = new Date('2024-01-01T10:00:00Z'); // 10 AM UTC
      const result = service.isAppropriateTimeForDelayedNotifications(mockUserPreferences, testTime);
      expect(result).toBe(true);
    });

    it('should return false during quiet hours', () => {
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM UTC
      const result = service.isAppropriateTimeForDelayedNotifications(mockUserPreferences, testTime);
      expect(result).toBe(false);
    });

    it('should return false during very early hours', () => {
      const testTime = new Date('2024-01-01T06:00:00Z'); // 6 AM UTC
      const result = service.isAppropriateTimeForDelayedNotifications(mockUserPreferences, testTime);
      expect(result).toBe(false);
    });

    it('should return true when quiet hours are disabled', () => {
      const disabledPrefs = { ...mockUserPreferences, quiet_hours_enabled: false };
      const testTime = new Date('2024-01-01T23:00:00Z'); // 11 PM UTC
      const result = service.isAppropriateTimeForDelayedNotifications(disabledPrefs, testTime);
      expect(result).toBe(true);
    });
  });
});