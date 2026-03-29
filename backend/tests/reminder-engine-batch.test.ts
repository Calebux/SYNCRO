import { ReminderEngine } from '../src/services/reminder-engine';
import { supabase } from '../src/config/database';
import logger from '../src/config/logger';

// Mock supabase and logger
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ error: null }),
  },
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('ReminderEngine Batch Optimization', () => {
  let engine: ReminderEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ReminderEngine();
  });

  it('should batch fetch process and batch upsert reminders', async () => {
    const mockSubscriptions = [
      { id: 'sub1', user_id: 'user1', active_until: '2026-04-01T00:00:00Z' },
      { id: 'sub2', user_id: 'user1', active_until: '2026-04-01T00:00:00Z' },
      { id: 'sub3', user_id: 'user2', active_until: '2026-04-01T00:00:00Z' },
    ];

    const mockPreferences = [
      { user_id: 'user1', reminder_timing: [7, 3] },
      { user_id: 'user2', reminder_timing: [1] },
    ];

    // Setup mocks
    (supabase.from as jest.Mock).mockImplementation((table) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                gt: () => Promise.resolve({ data: mockSubscriptions, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'user_preferences') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: mockPreferences, error: null }),
          }),
        };
      }
      if (table === 'reminder_schedules') {
        return {
          upsert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
    });

    await engine.scheduleReminders([7, 3, 1]);

    // Verify batch fetch of preferences
    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    
    // Verify batch upsert
    expect(supabase.from).toHaveBeenCalledWith('reminder_schedules');
    // Retrieve the actual mock instance used for 'reminder_schedules'
    const reminderStoreInstance = (supabase.from as jest.Mock).mock.results
      .find(r => r.value && typeof r.value === 'object' && 'upsert' in r.value)?.value;
    const upsertCall = (reminderStoreInstance.upsert as jest.Mock).mock.calls[0];
    const records = upsertCall[0];
    const options = upsertCall[1];

    // user1 has 2 subs * 2 days = 4 records
    // user2 has 1 sub * 1 day = 1 record
    // Total 5 records
    expect(records.length).toBe(5);
    expect(options.onConflict).toBe('subscription_id,reminder_date');

    // Verify logging
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Reminder scheduling completed in'));
  });
});
