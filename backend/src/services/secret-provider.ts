import { env } from '../config/env';
import logger from '../config/logger';

/**
 * Interface for secret retrieval.
 * Implementations can fetch secrets from .env, AWS Secrets Manager, HashiCorp Vault, etc.
 */
export interface SecretProvider {
  /**
   * Retrieves a secret by its key.
   * @param key The key of the secret to retrieve.
   * @returns A promise that resolves to the secret value.
   */
  getSecret(key: string): Promise<string | undefined>;
}

/**
 * Implementation of SecretProvider that reads from environment variables.
 */
export class LocalSecretProvider implements SecretProvider {
  async getSecret(key: string): Promise<string | undefined> {
    const val = (env as Record<string, unknown>)[key];
    if (typeof val === 'string') return val;
    return process.env[key];
  }
}

/**
 * Factory to create the appropriate SecretProvider based on configuration.
 */
export class SecretProviderFactory {
  private static instance: SecretProvider;

  static getProvider(): SecretProvider {
    if (!this.instance) {
      const type = env.SECRET_PROVIDER_TYPE || 'local';
      
      switch (type.toLowerCase()) {
        case 'local':
          this.instance = new LocalSecretProvider();
          break;
        // Future implementations:
        // case 'aws':
        //   this.instance = new AwsSecretProvider();
        //   break;
        default:
          logger.warn(`Unknown SecretProvider type: ${type}. Falling back to 'local'.`);
          this.instance = new LocalSecretProvider();
      }
    }
    return this.instance;
  }
}

export const secretProvider = SecretProviderFactory.getProvider();
