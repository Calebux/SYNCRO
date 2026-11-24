import { GmailTokenService } from '../src/services/gmail-token-service';
import * as encryption from '../src/utils/encryption';

let mockSupabase: any;

jest.mock('../src/config/database', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

const mockedFetch = jest.fn();
global.fetch = mockedFetch as unknown as typeof fetch;

describe('GmailTokenService Security and Lifecycle', () => {
  const mockUserId = 'user-123';
  const rawAccessToken = 'raw-access-token';
  const rawRefreshToken = 'raw-refresh-token';
  const encryptionKey = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = encryptionKey;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should encrypt tokens before saving to database', async () => {
    const encryptedRefresh = encryption.encrypt(rawRefreshToken);

    const updateMock = jest.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: 'acc-1', refresh_token: encryptedRefresh }
      }),
      update: updateMock,
    };

    mockedFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        access_token: 'new-raw-access',
        expires_in: 3600
      }),
    });

    await GmailTokenService.refreshAccessToken(mockUserId);

    // Verify update was called with encrypted content, not plaintext
    const updateCallArgs = updateMock.mock.calls[0][0];
    expect(updateCallArgs.access_token).not.toBe('new-raw-access');
    expect(updateCallArgs.access_token).toContain(':'); // IV:AuthTag:Cipher format
    
    // Verify we can decrypt it back to the original value
    const decrypted = encryption.decrypt(updateCallArgs.access_token);
    expect(decrypted).toBe('new-raw-access');
  });

  it('should prevent concurrent refresh (single-flight)', async () => {
    const encryptedRefresh = encryption.encrypt(rawRefreshToken);
    let callCount = 0;

    const updateMock = jest.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          data: { id: 'acc-1', refresh_token: encryptedRefresh }
        });
      }),
      update: updateMock,
    };

    // Mock fetch to resolve slowly so concurrent calls stack up
    mockedFetch.mockImplementation(() => 
      new Promise(resolve => 
        setTimeout(() => 
          resolve({
            ok: true,
            json: () => Promise.resolve({
              access_token: 'concurrent-test-token',
              expires_in: 3600
            })
          }), 100
        )
      )
    );

    // Launch 5 concurrent refresh calls
    const promises = Array.from({ length: 5 }, () => 
      GmailTokenService.refreshAccessToken(mockUserId)
    );

    // Wait for all to resolve
    const results = await Promise.all(promises);

    // Verify all got the same token
    expect(results.every(token => token === 'concurrent-test-token')).toBe(true);

    // Verify fetch was called only once (single-flight worked)
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Verify update was called only once
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('should revoke remote tokens and purge local credentials on disconnect', async () => {
    const encryptedRefresh = encryption.encrypt(rawRefreshToken);
    const encryptedAccess = encryption.encrypt(rawAccessToken);

    const deleteMock = jest.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { 
          id: 'acc-1', 
          refresh_token: encryptedRefresh,
          access_token: encryptedAccess 
        }
      }),
      delete: deleteMock,
    };
    mockedFetch.mockResolvedValue({ ok: true });

    await GmailTokenService.disconnectGmailAccount(mockUserId);

    // 1. Verify mock network revocation call was made with decrypted token
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining('revoke?token=' + rawRefreshToken),
      expect.objectContaining({ method: 'POST' })
    );

    // 2. Verify local database account was deleted
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
