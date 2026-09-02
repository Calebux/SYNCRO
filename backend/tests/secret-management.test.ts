import { secretProvider, LocalSecretProvider } from '../src/services/secret-provider';
import logger from '../src/config/logger';

describe('Secret Management', () => {
  describe('SecretProvider', () => {
    it('should be an instance of LocalSecretProvider by default', () => {
      expect(secretProvider).toBeInstanceOf(LocalSecretProvider);
    });

    it('should retrieve secrets from environment variables', async () => {
      process.env.TEST_SECRET = 'my-super-secret-value';
      const secret = await secretProvider.getSecret('TEST_SECRET');
      expect(secret).toBe('my-super-secret-value');
      delete process.env.TEST_SECRET;
    });

    it('should return undefined for non-existent secrets', async () => {
      const secret = await secretProvider.getSecret('NON_EXISTENT_SECRET');
      expect(secret).toBeUndefined();
    });

    it('supports overlapping versioned reads during rotation', async () => {
      const provider = new LocalSecretProvider();
      await provider.rotate('ROTATING_KEY', 'old-value', 'v1');
      await provider.rotate('ROTATING_KEY', 'new-value', 'v2');
      expect(await provider.get({ name: 'ROTATING_KEY', version: 'v1' })).toBe('old-value');
      expect(await provider.getSecret('ROTATING_KEY', 'v2')).toBe('new-value');
      expect((await provider.describe('ROTATING_KEY')).versions).toEqual(expect.arrayContaining(['v1', 'v2']));
      delete process.env.ROTATING_KEY;
      delete process.env.ROTATING_KEY__v1;
      delete process.env.ROTATING_KEY__v2;
    });

    it('refuses the environment backend in production', () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      expect(() => new LocalSecretProvider()).toThrow('disabled in production');
      process.env.NODE_ENV = previous;
    });
  });

  describe('Log Masking', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      // Mock the console.log to capture output
      logSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('should mask sensitive keys in log objects', () => {
      const sensitiveData = {
        name: 'John',
        userId: '123',
        password: 'my-password',
        jwt_secret: 'my-jwt-secret',
        nested: {
          stripe_secret_key: 'sk_test_123'
        }
      };

      logger.info('Testing masking', sensitiveData);

      // Verify that the output doesn't contain the raw secrets
      const output = logSpy.mock.calls.map(call => call[0].toString()).join('');
      
      expect(output).not.toContain('my-password');
      expect(output).not.toContain('my-jwt-secret');
      expect(output).not.toContain('sk_test_123');
      expect(output).toContain('***MASKED***');
      expect(output).toContain('John'); // Non-sensitive data should remain
    });

    it('should not mask non-sensitive keys', () => {
      logger.info('Testing normal data', { name: 'John Doe', age: 30 });
      
      const output = logSpy.mock.calls.map(call => call[0].toString()).join('');
      expect(output).toContain('John Doe');
      expect(output).toContain('30');
      expect(output).not.toContain('***MASKED***');
    });

    it('should mask sensitive keys even if they are part of a larger key name', () => {
      logger.info('Testing partial match', { myAwesomeSecret: 'sensitive-value' });
      
      const output = logSpy.mock.calls.map(call => call[0].toString()).join('');
      expect(output).not.toContain('sensitive-value');
      expect(output).toContain('***MASKED***');
    });
  });
});
