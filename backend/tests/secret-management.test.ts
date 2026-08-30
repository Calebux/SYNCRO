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
