jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/services/telegram-bot-service', () => ({
  telegramBotService: {
    sendSimpleMessage: jest.fn().mockResolvedValue({ success: true }),
    sendRenewalReminder: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../src/services/user-preference-service', () => ({
  userPreferenceService: {
    getPreferences: jest.fn().mockResolvedValue({
      notification_channels: ['telegram'],
      email_opt_ins: { reminders: true },
    }),
  },
}));

import { TelegramNotificationService } from '../src/services/telegram-notification-service';
import { telegramBotService } from '../src/services/telegram-bot-service';
import { userPreferenceService } from '../src/services/user-preference-service';
import { supabase } from '../src/config/database';

describe('TelegramNotificationService', () => {
  let service: TelegramNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    (userPreferenceService.getPreferences as jest.Mock).mockResolvedValue({
      notification_channels: ['telegram'],
      email_opt_ins: { reminders: true },
    });
    service = new TelegramNotificationService();
  });

  it('sends payment confirmation when telegram is enabled', async () => {
    await service.sendPaymentConfirmation('user-1', {
      subscriptionName: 'Netflix',
      amount: 15.99,
      currency: 'USD',
      billingCycle: 'monthly',
      transactionHash: 'abc123def456',
    });

    expect(telegramBotService.sendSimpleMessage).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('Payment Confirmed'),
    );
  });

  it('skips payment confirmation when telegram channel disabled', async () => {
    (userPreferenceService.getPreferences as jest.Mock).mockResolvedValue({
      notification_channels: ['email'],
      email_opt_ins: { reminders: true },
    });

    await service.sendPaymentConfirmation('user-1', {
      subscriptionName: 'Netflix',
      amount: 15.99,
    });

    expect(telegramBotService.sendSimpleMessage).not.toHaveBeenCalled();
  });

  it('sends weekly spending summary with subscription totals', async () => {
    const eqMock = jest.fn().mockResolvedValue({
      data: [
        { name: 'Netflix', price: 15.99, currency: 'USD', billing_cycle: 'monthly', status: 'active' },
        { name: 'Spotify', price: 9.99, currency: 'USD', billing_cycle: 'monthly', status: 'active' },
      ],
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: eqMock }) }),
    });

    await service.sendWeeklySpendingSummary('user-1');

    expect(telegramBotService.sendSimpleMessage).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('Weekly Spending Summary'),
    );
  });
});
