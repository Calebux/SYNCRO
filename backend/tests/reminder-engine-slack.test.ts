import { ReminderEngine } from '../src/services/reminder-engine';
import logger from '../src/config/logger';

// We'll inject mocks into the engine instead of using module-level mocks.

describe('ReminderEngine Slack delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends Slack notifications and records delivery status', async () => {
    // Build mocks to inject
    const mockSupabase: any = {
      from: jest.fn((table: string) => {
        if (table === 'reminder_schedules') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            upsert: jest.fn().mockResolvedValue({ error: null }),
            single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          };
        }
        if (table === 'subscriptions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'sub-1',
                user_id: 'user-1',
                name: 'Netflix',
                provider: 'Netflix',
                category: 'Streaming',
                price: 15.99,
                billing_cycle: 'monthly',
                status: 'active',
                next_billing_date: '2026-06-01T00:00:00Z',
                active_until: '2026-06-01T00:00:00Z',
              },
              error: null,
            }),
          };
        }
        if (table === 'notification_deliveries') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'delivery-1',
                    reminder_schedule_id: 'reminder-1',
                    user_id: 'user-1',
                    channel: 'slack',
                    status: 'pending',
                    attempt_count: 0,
                    max_attempts: 3,
                    last_attempt_at: null,
                    next_retry_at: null,
                    error_message: null,
                    metadata: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          gt: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          upsert: jest.fn().mockResolvedValue({ error: null }),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        };
      }),
      auth: {
        admin: { getUserById: jest.fn().mockResolvedValue({ user: { email: 'user@example.com' } }) },
      },
    };

    const mockSlack = { sendReminderNotification: jest.fn().mockResolvedValue({ success: true, metadata: { channel: 'slack' } }) };
    const mockBlockchain = { logReminderEvent: jest.fn().mockResolvedValue({ success: true }) };
    const mockUserPref = { getPreferences: jest.fn().mockResolvedValue({
      user_id: 'user-1',
      notification_channels: ['slack'],
      reminder_timing: [7,3,1],
      email_opt_ins: { marketing: false, reminders: false, updates: true },
    }) };

    const engine = new ReminderEngine({
      supabase: mockSupabase,
      slackService: mockSlack,
      blockchainService: mockBlockchain,
      userPreferenceService: mockUserPref,
      logger,
      clock: { now: () => new Date('2026-05-25T00:00:00.000Z') },
    } as any);

    await (engine as any).processReminder({
      id: 'reminder-1',
      subscription_id: 'sub-1',
      user_id: 'user-1',
      reminder_date: '2026-05-25',
      reminder_type: 'renewal',
      days_before: 7,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(mockSlack.sendReminderNotification).toHaveBeenCalledTimes(1);
    expect(mockBlockchain.logReminderEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ subscription: expect.objectContaining({ id: 'sub-1' }) }),
      ['slack'],
    );
  });
});
