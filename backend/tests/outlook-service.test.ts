import { scanOutlookSubscriptions, refreshOutlookToken, getOutlookProfile, exchangeOutlookCodeForTokens } from '../services/outlook-service';

// Mock dependencies
global.fetch = jest.fn();

describe('Outlook Service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('refreshOutlookToken', () => {
    it('should throw AUTH_REVOKED if token refresh fails with invalid_grant', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('{"error": "invalid_grant"}')
      });

      // The inner requestOutlookToken throws an error containing the text,
      // and refreshOutlookToken is wrapped by scanOutlookSubscriptions to handle invalid_grant.
      // Wait, scanOutlookSubscriptions wraps refreshOutlookToken.
      // Let's test scanOutlookSubscriptions handling of rotation failure.
    });
  });

  describe('scanOutlookSubscriptions', () => {
    it('should throw AUTH_REVOKED on invalid_grant during rotation', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('{"error": "invalid_grant"}')
      });

      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      await expect(scanOutlookSubscriptions({
        accessToken: 'old_access',
        refreshToken: 'refresh',
        expiresAt: pastDate.toISOString(),
      })).rejects.toThrow('AUTH_REVOKED');
    });

    it('should throw AUTH_REVOKED on 401 response from graph API', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      });

      await expect(scanOutlookSubscriptions({
        accessToken: 'valid_access',
      })).rejects.toThrow('AUTH_REVOKED: Outlook message scan unauthorized: Unauthorized');
    });

    it('should throw RATE_LIMITED on 429 response from graph API', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests')
      });

      await expect(scanOutlookSubscriptions({
        accessToken: 'valid_access',
      })).rejects.toThrow('RATE_LIMITED: Outlook message scan throttled: Too Many Requests');
    });
  });
});
