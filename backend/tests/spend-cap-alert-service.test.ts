jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: { admin: { getUserById: jest.fn() } },
  },
}));
jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/services/email-service', () => ({
  emailService: { sendSimpleEmail: jest.fn() },
}));
jest.mock('../src/services/telegram-bot-service', () => ({
  telegramBotService: { sendSimpleMessage: jest.fn() },
}));

import { supabase } from '../src/config/database';
import { emailService } from '../src/services/email-service';
import { spendCapAlertService } from '../src/services/spend-cap-alert-service';

function query(result: unknown) {
  const builder: Record<string, jest.Mock | ((resolve: (value: unknown) => unknown) => Promise<unknown>)> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.delete = jest.fn(() => builder);
  builder.single = jest.fn(async () => result);
  builder.maybeSingle = jest.fn(async () => result);
  builder.then = (resolve) => Promise.resolve(result).then(resolve);
  return builder;
}

describe('SpendCapAlertService', () => {
  const from = supabase.from as jest.Mock;
  const getUserById = supabase.auth.admin.getUserById as jest.Mock;
  const sendSimpleEmail = emailService.sendSimpleEmail as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    from.mockImplementation((table: string) => {
      if (table === 'payment_channels') {
        return query({
          data: [{ channel_id: 'agent-1', user_id: 'principal-1', balance: 0, deposit_amount: 100 }],
          error: null,
        });
      }
      if (table === 'user_preferences') {
        return query({ data: { spend_cap_alert_channels: [] }, error: null });
      }
      return query({ data: { id: 'alert-log' }, error: null });
    });
    getUserById.mockResolvedValue({ data: { user: { email: 'principal@example.test' } }, error: null });
    sendSimpleEmail.mockResolvedValue(undefined);
  });

  it('does not deliver notifications when no channel is opted in', async () => {
    await expect(spendCapAlertService.run(new Date('2026-10-20T00:00:00.000Z'))).resolves.toBe(0);
    expect(sendSimpleEmail).not.toHaveBeenCalled();
  });

  it('sends 80% and 100% email alerts when email is selected', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'payment_channels') {
        return query({
          data: [{ channel_id: 'agent-1', user_id: 'principal-1', balance: 0, deposit_amount: 100 }],
          error: null,
        });
      }
      if (table === 'user_preferences') {
        return query({ data: { spend_cap_alert_channels: ['email'] }, error: null });
      }
      return query({ data: { id: 'alert-log' }, error: null });
    });

    await expect(spendCapAlertService.run(new Date('2026-10-20T00:00:00.000Z'))).resolves.toBe(2);
    expect(sendSimpleEmail).toHaveBeenCalledTimes(2);
    expect(sendSimpleEmail.mock.calls.map((call) => call[1])).toEqual([
      'SYNCRO spend-cap 80% alert',
      'SYNCRO spend-cap 100% alert',
    ]);
  });
});
