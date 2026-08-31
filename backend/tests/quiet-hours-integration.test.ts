import { QuietHoursService } from '../src/services/quiet-hours-service';
import { DelayedNotificationService } from '../src/services/delayed-notification-service';
import { UserPreferences, NotificationPayload } from '../src/types/reminder';

describe('Quiet Hours Integration', () => {
  let quietHoursService: QuietHoursService;
  let delayedNotificationService: DelayedNotificationService;

  beforeEach(() => {
    quietHoursService = new QuietHoursService();
    delayedNotificationService = new DelayedNotificationService();
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

  describe('End-to-End Quiet Hours Flow', () => {
    it('should handle critical alerts during quiet hours', () => {
      // Test at 11 PM (23:00) - in quiet hours
      const testTime = new Date('2024-01-01T23:00:00Z');
      
      const criticalPayload: NotificationPayload = {
        title: 'Critical Renewal Alert',
        body: 'Your subscription expires tomorrow!',
        subscription: { id: 'test-sub', name: 'Test Service' } as any,
        reminderType: 'renewal',
        daysBefore: 1,
        renewalDate: new Date().toISOString(),
      };

      // Check if we're in quiet hours
      const isQuietHours = quietHoursService.isInQuietHours(mockUserPreferences, testTime);
      expect(isQuietHours).toBe(true);

      // Check if critical alert should be sent
      const quietHoursCheck = quietHoursService.shouldSendDuringQuietHours(
        mockUserPreferences,
        criticalPayload,
        testTime
      );

      expect(quietHoursCheck.isQuietHours).toBe(true);
      expect(quietHoursCheck.shouldDelay).toBe(false);
      expect(quietHoursCheck.reason).toContain('Critical alert allowed');
    });

    it('should delay non-critical alerts during quiet hours', () => {
      // Test at 11 PM (23:00) - in quiet hours
      const testTime = new Date('2024-01-01T23:00:00Z');
      
      const normalPayload: NotificationPayload = {
        title: 'Renewal Reminder',
        body: 'Your subscription renews in 7 days',
        subscription: { id: 'test-sub', name: 'Test Service' } as any,
        reminderType: 'renewal',
        daysBefore: 7,
        renewalDate: new Date().toISOString(),
      };

      // Check if we're in quiet hours
      const isQuietHours = quietHoursService.isInQuietHours(mockUserPreferences, testTime);
      expect(isQuietHours).toBe(true);

      // Check if normal alert should be delayed
      const quietHoursCheck = quietHoursService.shouldSendDuringQuietHours(
        mockUserPreferences,
        normalPayload,
        testTime
      );

      expect(quietHoursCheck.isQuietHours).toBe(true);
      expect(quietHoursCheck.shouldDelay).toBe(true);
      expect(quietHoursCheck.delayUntil).toBeDefined();
      expect(quietHoursCheck.reason).toContain('Non-critical alert delayed');

      // Verify the delay time is calculated correctly
      const delayUntil = quietHoursCheck.delayUntil!;
      expect(delayUntil.getUTCHours()).toBe(8); // Should be 8 AM
      expect(delayUntil.getUTCDate()).toBe(2); // Next day
    });

    it('should allow all alerts outside quiet hours', () => {
      // Test at 10 AM (10:00) - outside quiet hours
      const testTime = new Date('2024-01-01T10:00:00Z');
      
      const normalPayload: NotificationPayload = {
        title: 'Renewal Reminder',
        body: 'Your subscription renews in 7 days',
        subscription: { id: 'test-sub', name: 'Test Service' } as any,
        reminderType: 'renewal',
        daysBefore: 7,
        renewalDate: new Date().toISOString(),
      };

      // Check if we're in quiet hours
      const isQuietHours = quietHoursService.isInQuietHours(mockUserPreferences, testTime);
      expect(isQuietHours).toBe(false);

      // Check if alert should be sent immediately
      const quietHoursCheck = quietHoursService.shouldSendDuringQuietHours(
        mockUserPreferences,
        normalPayload,
        testTime
      );

      expect(quietHoursCheck.isQuietHours).toBe(false);
      expect(quietHoursCheck.shouldDelay).toBe(false);
    });

    it('should handle disabled quiet hours correctly', () => {
      const disabledPrefs = { ...mockUserPreferences, quiet_hours_enabled: false };
      
      // Test at 11 PM (23:00) - would be in quiet hours if enabled
      const testTime = new Date('2024-01-01T23:00:00Z');
      
      const normalPayload: NotificationPayload = {
        title: 'Renewal Reminder',
        body: 'Your subscription renews in 7 days',
        subscription: { id: 'test-sub', name: 'Test Service' } as any,
        reminderType: 'renewal',
        daysBefore: 7,
        renewalDate: new Date().toISOString(),
      };

      // Check if we're in quiet hours (should be false when disabled)
      const isQuietHours = quietHoursService.isInQuietHours(disabledPrefs, testTime);
      expect(isQuietHours).toBe(false);

      // Check if alert should be sent immediately
      const quietHoursCheck = quietHoursService.shouldSendDuringQuietHours(
        disabledPrefs,
        normalPayload,
        testTime
      );

      expect(quietHoursCheck.isQuietHours).toBe(false);
      expect(quietHoursCheck.shouldDelay).toBe(false);
    });

    it('should correctly identify appropriate times for delayed notifications', () => {
      // Test 6 AM - too early
      const time6AM = new Date('2024-01-01T06:00:00Z');
      const result6AM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time6AM);
      expect(result6AM).toBe(false);

      // Test 8 AM - appropriate
      const time8AM = new Date('2024-01-01T08:00:00Z');
      const result8AM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time8AM);
      expect(result8AM).toBe(true);

      // Test 12 PM - appropriate
      const time12PM = new Date('2024-01-01T12:00:00Z');
      const result12PM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time12PM);
      expect(result12PM).toBe(true);

      // Test 9:59 PM - appropriate (just before quiet hours)
      const time9_59PM = new Date('2024-01-01T21:59:00Z');
      const result9_59PM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time9_59PM);
      expect(result9_59PM).toBe(true);

      // Test 10 PM - in quiet hours
      const time10PM = new Date('2024-01-01T22:00:00Z');
      const result10PM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time10PM);
      expect(result10PM).toBe(false);

      // Test 11 PM - in quiet hours
      const time11PM = new Date('2024-01-01T23:00:00Z');
      const result11PM = quietHoursService.isAppropriateTimeForDelayedNotifications(mockUserPreferences, time11PM);
      expect(result11PM).toBe(false);
    });
  });

  describe('Priority Classification', () => {
    it('should correctly classify different notification types', () => {
      const testCases = [
        {
          payload: { reminderType: 'renewal', daysBefore: 0 } as Partial<NotificationPayload>,
          expected: 'critical',
          description: 'renewal today'
        },
        {
          payload: { reminderType: 'renewal', daysBefore: 1 } as Partial<NotificationPayload>,
          expected: 'critical',
          description: 'renewal tomorrow'
        },
        {
          payload: { reminderType: 'trial_expiry', daysBefore: 0 } as Partial<NotificationPayload>,
          expected: 'critical',
          description: 'trial expiring today'
        },
        {
          payload: { reminderType: 'trial_expiry', daysBefore: 2 } as Partial<NotificationPayload>,
          expected: 'high',
          description: 'trial expiring in 2 days'
        },
        {
          payload: { reminderType: 'renewal', daysBefore: 3 } as Partial<NotificationPayload>,
          expected: 'high',
          description: 'renewal in 3 days'
        },
        {
          payload: { reminderType: 'renewal', daysBefore: 7 } as Partial<NotificationPayload>,
          expected: 'normal',
          description: 'renewal in 7 days'
        },
        {
          payload: { reminderType: 'cancellation', daysBefore: 1 } as Partial<NotificationPayload>,
          expected: 'low',
          description: 'cancellation reminder'
        },
      ];

      testCases.forEach(({ payload, expected, description }) => {
        const fullPayload = {
          title: 'Test',
          body: 'Test',
          subscription: { id: 'test' } as any,
          renewalDate: new Date().toISOString(),
          ...payload,
        } as NotificationPayload;

        const priority = quietHoursService.determineNotificationPriority(fullPayload);
        expect(priority).toBe(expected);
      });
    });
  });
});