import { fullUserPreferencesUpdateSchema } from '../src/schemas/user-preferences';

describe('spend-cap alert preferences', () => {
  it('accepts partial updates with email and Telegram destinations', () => {
    expect(fullUserPreferencesUpdateSchema.parse({
      spend_cap_alert_channels: ['email', 'telegram'],
    })).toEqual({
      spend_cap_alert_channels: ['email', 'telegram'],
    });
  });

  it('rejects duplicate or unsupported destinations', () => {
    expect(fullUserPreferencesUpdateSchema.safeParse({
      spend_cap_alert_channels: ['email', 'email'],
    }).success).toBe(false);
    expect(fullUserPreferencesUpdateSchema.safeParse({
      spend_cap_alert_channels: ['slack'],
    }).success).toBe(false);
  });
});
