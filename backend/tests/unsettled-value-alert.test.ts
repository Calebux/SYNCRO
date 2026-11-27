process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.UNSETTLED_PER_CHANNEL_THRESHOLD = '1000';
process.env.UNSETTLED_TOTAL_THRESHOLD = '5000';

jest.mock('../src/services/slack-service', () => ({
  slackService: { sendCustomMessage: jest.fn().mockResolvedValue(undefined) },
}));

import { paidCallAlertService } from '../src/services/paid-call-alert-service';
import { slackService } from '../src/services/slack-service';

describe('unsettled value alerts (issue #1690)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fires when a channel exceeds its threshold', async () => {
    await paidCallAlertService.checkUnsettledValue([
      { channelId: 'ch-1', userId: 'u-1', providerId: 'prov-1', unsettledValue: 2500, channelSize: 10000 },
    ]);
    expect(slackService.sendCustomMessage).toHaveBeenCalled();
    const message = String((slackService.sendCustomMessage as jest.Mock).mock.calls[0][0]);
    expect(message).toMatch(/ch-1/);
  });

  it('fires when the total exceeds the global threshold', async () => {
    await paidCallAlertService.checkUnsettledValue([
      { channelId: 'ch-a', userId: 'u-1', providerId: 'prov-1', unsettledValue: 900, channelSize: 100000 },
      { channelId: 'ch-b', userId: 'u-2', providerId: 'prov-2', unsettledValue: 900, channelSize: 100000 },
      { channelId: 'ch-c', userId: 'u-3', providerId: 'prov-3', unsettledValue: 900, channelSize: 100000 },
      { channelId: 'ch-d', userId: 'u-4', providerId: 'prov-4', unsettledValue: 900, channelSize: 100000 },
      { channelId: 'ch-e', userId: 'u-5', providerId: 'prov-5', unsettledValue: 900, channelSize: 100000 },
      { channelId: 'ch-f', userId: 'u-6', providerId: 'prov-6', unsettledValue: 900, channelSize: 100000 },
    ]);
    const calls = (slackService.sendCustomMessage as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => m.includes('Total unsettled value'))).toBe(true);
  });
});
