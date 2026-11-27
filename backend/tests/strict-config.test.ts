import { validateEnv, envSchema } from '../src/config/env';

describe('Strict Environment Configuration System', () => {
  const originalEnv = process.env;

  const validEnvVars: Record<string, string> = {
    PORT: '3001',
    NODE_ENV: 'test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-1234567890',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-1234567890',
    JWT_SECRET: 'secret123456789012345678901234567890',
    ADMIN_API_KEY: 'admin-key-1234567890',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'password123',
    STELLAR_NETWORK_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_CONTRACT_ADDRESS: 'CA123456789012345678901234567890',
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...validEnvVars };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('validates and freezes configuration when all required variables are present', () => {
    const config = validateEnv();
    expect(config.PORT).toBe(3001);
    expect(config.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('prevents mutating the parsed env object', () => {
    const config = validateEnv();
    expect(() => {
      (config as any).PORT = 9999;
    }).toThrow();
  });

  it('fails fast with aggregated readable errors when required variables are missing', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.JWT_SECRET;

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => validateEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it('refuses to start in production if DEV_BYPASS_AUTH is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK_URL = 'https://horizon.stellar.org';
    process.env.DEV_BYPASS_AUTH = 'true';

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => validateEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it('refuses to start in production if CHANNEL_SIGNING_SECRET is using dev fallback', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK_URL = 'https://horizon.stellar.org';
    process.env.CHANNEL_SIGNING_SECRET = 'dev-channel-secret';

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => validateEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
