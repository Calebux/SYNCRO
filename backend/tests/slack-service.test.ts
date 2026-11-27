import { SlackService } from '../src/services/slack-service';
import { NotificationPayload } from '../src/types/reminder';

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

describe('SlackService', () => {
  const payload: NotificationPayload = {
    title: 'Renewal reminder',
    body: 'Netflix renews soon',
    subscription: {
      id: 'sub-1',
      user_id: 'user-1',
      email_account_id: null,
      merchant_id: null,
      name: 'Netflix',
      provider: 'Netflix',
      category: 'Streaming',
      price: 15.99,
      billing_cycle: 'monthly',
      status: 'active',
      next_billing_date: '2026-06-01T00:00:00Z',
      logo_url: null,
      website_url: null,
      renewal_url: 'https://netflix.com/account',
      notes: null,
      tags: [],
      expired_at: null,
      active_until: '2026-06-01T00:00:00Z',
      is_trial: false,
      trial_ends_at: null,
      trial_converts_to_price: null,
      credit_card_required: false,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    } as any,
    reminderType: 'renewal',
    daysBefore: 7,
    renewalDate: '2026-06-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('posts a Slack message when configured', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);

    const service = new SlackService('https://hooks.slack.com/services/T000/B000/TEST');
    const result = await service.sendReminderNotification(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.metadata?.channel).toBe('slack');
  });

  it('marks non-2xx Slack responses as retryable when appropriate', async () => {
    jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'upstream error',
    } as Response);

    const service = new SlackService('https://hooks.slack.com/services/T000/B000/TEST');
    const result = await service.sendReminderNotification(payload);

    expect(result.success).toBe(false);
    expect(result.metadata?.retryable).toBe(true);
  });
});
