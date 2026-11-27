import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import logger from '../config/logger';

export interface SecretId { name: string; version?: string }
export interface SecretContext { caller: string; purpose: string }
export interface SecretDescription { id: SecretId; versions: string[]; current?: string }
export interface SecretProvider {
  get(id: SecretId, context?: SecretContext): Promise<string | undefined>;
  rotate(name: string, value: string, version: string, context?: SecretContext): Promise<SecretId>;
  describe(name: string): Promise<SecretDescription>;
  getSecret(key: string, version?: string, context?: SecretContext): Promise<string | undefined>;
}

abstract class AuditedProvider implements SecretProvider {
  abstract get(id: SecretId, context?: SecretContext): Promise<string | undefined>;
  abstract rotate(name: string, value: string, version: string, context?: SecretContext): Promise<SecretId>;
  abstract describe(name: string): Promise<SecretDescription>;
  getSecret(key: string, version?: string, context?: SecretContext) { return this.get({ name: key, version }, context); }
  protected audit(action: 'get' | 'rotate', id: SecretId, context?: SecretContext) {
    if (process.env.NODE_ENV === 'production') logger.info('secret_access', {
      action, secret: id.name, version: id.version,
      caller: context?.caller ?? 'unknown', purpose: context?.purpose ?? 'unspecified',
    });
  }
}

/** Development-only versioned environment backend. NAME__VERSION overrides NAME. */
export class LocalSecretProvider extends AuditedProvider {
  constructor() { super(); if (process.env.NODE_ENV === 'production') throw new Error('Environment secrets are disabled in production'); }
  async get(id: SecretId, context?: SecretContext) {
    this.audit('get', id, context);
    return process.env[id.version ? `${id.name}__${id.version}` : id.name];
  }
  async rotate(name: string, value: string, version: string, context?: SecretContext) {
    process.env[`${name}__${version}`] = value; process.env[name] = value;
    const id = { name, version }; this.audit('rotate', id, context); return id;
  }
  async describe(name: string) {
    const prefix = `${name}__`;
    const versions = Object.keys(process.env).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
    return { id: { name }, versions, current: process.env[name] ? 'environment' : undefined };
  }
}

export class AwsSecretProvider extends AuditedProvider {
  constructor(private readonly client = new SecretsManagerClient({})) { super(); }
  async get(id: SecretId, context?: SecretContext) {
    const result = await this.client.send(new GetSecretValueCommand({ SecretId: id.name, VersionId: id.version }));
    this.audit('get', id, context); return result.SecretString;
  }
  async rotate(name: string, value: string, version: string, context?: SecretContext) {
    try { await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value, ClientRequestToken: version })); }
    catch (error) {
      if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: value, ClientRequestToken: version }));
    }
    const id = { name, version }; this.audit('rotate', id, context); return id;
  }
  async describe(name: string) {
    const result = await this.client.send(new DescribeSecretCommand({ SecretId: name }));
    const stages = result.VersionIdsToStages ?? {};
    return { id: { name }, versions: Object.keys(stages), current: Object.entries(stages).find(([, v]) => v.includes('AWSCURRENT'))?.[0] };
  }
}

export class VaultSecretProvider extends AuditedProvider {
  constructor(private readonly address = process.env.VAULT_ADDR!, private readonly token = process.env.VAULT_TOKEN!, private readonly mount = process.env.VAULT_MOUNT ?? 'secret') { super(); }
  private async request(name: string, init?: RequestInit, version?: string) {
    const query = version ? `?version=${encodeURIComponent(version)}` : '';
    const response = await fetch(`${this.address}/v1/${this.mount}/data/${encodeURIComponent(name)}${query}`, {
      ...init, headers: { 'X-Vault-Token': this.token, 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) throw new Error(`Vault request failed (${response.status})`);
    return response.json() as Promise<{ data: { data?: { value?: string }; metadata: { version: number } } }>;
  }
  async get(id: SecretId, context?: SecretContext) {
    const result = await this.request(id.name, undefined, id.version); this.audit('get', id, context); return result.data.data?.value;
  }
  async rotate(name: string, value: string, version: string, context?: SecretContext) {
    const result = await this.request(name, { method: 'POST', body: JSON.stringify({ data: { value } }) });
    const id = { name, version: String(result.data.metadata.version || version) }; this.audit('rotate', id, context); return id;
  }
  async describe(name: string) {
    const result = await this.request(name); const current = String(result.data.metadata.version);
    return { id: { name }, versions: [current], current };
  }
}

export class SecretProviderFactory {
  private static instance: SecretProvider;
  static getProvider(): SecretProvider {
    if (!this.instance) {
      const type = (process.env.SECRET_PROVIDER_TYPE ?? 'local').toLowerCase();
      this.instance = type === 'aws' ? new AwsSecretProvider() : type === 'vault' ? new VaultSecretProvider() : new LocalSecretProvider();
    }
    return this.instance;
  }
}
export const secretProvider = SecretProviderFactory.getProvider();
