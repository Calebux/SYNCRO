import * as crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../utils/logger';
import { getTTLConfig, SnapshotStorageBackend } from '../config/ttl-config';

const logger = getLogger('snapshot-storage');

/**
 * Snapshot storage abstraction supporting multiple backends (S3, local, IPFS).
 * Handles encryption/decryption and integrity verification.
 */
export class SnapshotStorage {
  private s3Client: S3Client | null = null;
  private localArchiveDir: string;

  constructor() {
    const config = getTTLConfig();
    this.localArchiveDir = path.resolve(process.cwd(), 'archives');

    if (config.snapshotStorage === SnapshotStorageBackend.S3) {
      this.s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
      });
    }
  }

  /**
   * Redact sensitive fields from a snapshot object for privacy.
   * Removes PII, payment details, and other sensitive data.
   */
  static redactSensitiveFields(snapshot: Record<string, any>): Record<string, any> {
    const redacted = JSON.parse(JSON.stringify(snapshot));

    // Recursively redact sensitive keys
    const sensitiveKeys = [
      'approvalState',
      'paymentDetails',
      'creditCard',
      'bankAccount',
      'ssn',
      'taxId',
      'phoneNumber',
      'email',
      'address',
      'dateOfBirth',
      'socialSecurityNumber',
    ];

    function redactObject(obj: any): any {
      if (obj === null || obj === undefined) {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(redactObject);
      }
      if (typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (sensitiveKeys.includes(key)) {
            result[key] = 'REDACTED_FOR_PRIVACY';
          } else {
            result[key] = redactObject(value);
          }
        }
        return result;
      }
      return obj;
    }

    return redactObject(redacted);
  }

  /**
   * Compute SHA-256 hash of a snapshot object.
   * Used as proof of archival and for integrity verification.
   */
  static computeSnapshotHash(snapshotData: Record<string, any> | string): string {
    const jsonString = typeof snapshotData === 'string' ? snapshotData : JSON.stringify(snapshotData);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Encrypt a snapshot using AES-256-GCM.
   * Returns { encrypted: Buffer, iv: Buffer, authTag: Buffer }
   */
  static encryptSnapshot(
    snapshotData: string,
    encryptionKey: Buffer,
  ): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    let encrypted = cipher.update(snapshotData, 'utf-8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  /**
   * Decrypt a snapshot using AES-256-GCM.
   */
  static decryptSnapshot(
    encrypted: Buffer,
    iv: Buffer,
    authTag: Buffer,
    encryptionKey: Buffer,
  ): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf-8');
  }

  /**
   * Store a snapshot in the configured backend (S3, local, or IPFS).
   * Returns the storage path for reference.
   */
  async storeSnapshot(
    snapshotPath: string,
    snapshotData: Record<string, any>,
    encryptionKey?: Buffer,
  ): Promise<string> {
    const config = getTTLConfig();
    const jsonString = JSON.stringify(snapshotData);
    const hash = SnapshotStorage.computeSnapshotHash(jsonString);

    logger.info('Storing snapshot', { snapshotPath, hash, backend: config.snapshotStorage });

    if (config.snapshotStorage === SnapshotStorageBackend.S3) {
      return this.storeToS3(snapshotPath, jsonString, hash, encryptionKey);
    } else if (config.snapshotStorage === SnapshotStorageBackend.Local) {
      return this.storeLocally(snapshotPath, jsonString, hash, encryptionKey);
    } else {
      throw new Error(`Unsupported snapshot storage backend: ${config.snapshotStorage}`);
    }
  }

  /**
   * Retrieve a snapshot from the configured backend.
   */
  async retrieveSnapshot(snapshotPath: string, encryptionKey?: Buffer): Promise<Record<string, any>> {
    const config = getTTLConfig();

    logger.info('Retrieving snapshot', { snapshotPath, backend: config.snapshotStorage });

    if (config.snapshotStorage === SnapshotStorageBackend.S3) {
      return this.retrieveFromS3(snapshotPath, encryptionKey);
    } else if (config.snapshotStorage === SnapshotStorageBackend.Local) {
      return this.retrieveLocally(snapshotPath, encryptionKey);
    } else {
      throw new Error(`Unsupported snapshot storage backend: ${config.snapshotStorage}`);
    }
  }

  /**
   * Delete a snapshot from the configured backend.
   */
  async deleteSnapshot(snapshotPath: string): Promise<void> {
    const config = getTTLConfig();

    logger.info('Deleting snapshot', { snapshotPath, backend: config.snapshotStorage });

    if (config.snapshotStorage === SnapshotStorageBackend.S3) {
      await this.deleteFromS3(snapshotPath);
    } else if (config.snapshotStorage === SnapshotStorageBackend.Local) {
      await this.deleteLocally(snapshotPath);
    } else {
      throw new Error(`Unsupported snapshot storage backend: ${config.snapshotStorage}`);
    }
  }

  /**
   * Store snapshot to S3 with optional encryption.
   */
  private async storeToS3(
    snapshotPath: string,
    jsonString: string,
    hash: string,
    encryptionKey?: Buffer,
  ): Promise<string> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const config = getTTLConfig();
    let body: Buffer | string = jsonString;
    const metadata: Record<string, string> = {
      'snapshot-hash': hash,
      'archival-timestamp': new Date().toISOString(),
    };

    if (config.snapshotEncryption && encryptionKey) {
      const { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(jsonString, encryptionKey);
      body = Buffer.concat([iv, authTag, encrypted]);
      metadata['encrypted'] = 'true';
      metadata['iv'] = iv.toString('hex');
      metadata['auth-tag'] = authTag.toString('hex');
    }

    const key = `${config.snapshotBucket}/${snapshotPath}/${hash}.snapshot`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: config.snapshotBucket,
        Key: key,
        Body: body,
        ServerSideEncryption: 'AES256',
        Metadata: metadata,
      }),
    );

    logger.info('Snapshot stored to S3', { key });
    return key;
  }

  /**
   * Retrieve snapshot from S3 with optional decryption.
   */
  private async retrieveFromS3(snapshotPath: string, encryptionKey?: Buffer): Promise<Record<string, any>> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const config = getTTLConfig();
    const [snapshotDir, hash] = snapshotPath.split('/').slice(-2);
    const key = `${config.snapshotBucket}/${snapshotPath}/${hash}.snapshot`;

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: config.snapshotBucket,
        Key: key,
      }),
    );

    const body = await response.Body?.transformToByteArray();
    if (!body) {
      throw new Error(`Failed to retrieve snapshot from S3: ${key}`);
    }

    let jsonString: string;

    if (response.Metadata?.['encrypted'] === 'true' && encryptionKey) {
      const ivHex = response.Metadata['iv'];
      const authTagHex = response.Metadata['auth-tag'];
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(body.slice(0, body.length - 16));
      jsonString = SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey);
    } else {
      jsonString = Buffer.from(body).toString('utf-8');
    }

    return JSON.parse(jsonString);
  }

  /**
   * Delete snapshot from S3.
   */
  private async deleteFromS3(snapshotPath: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const config = getTTLConfig();
    const [snapshotDir, hash] = snapshotPath.split('/').slice(-2);
    const key = `${config.snapshotBucket}/${snapshotPath}/${hash}.snapshot`;

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.snapshotBucket,
        Key: key,
      }),
    );

    logger.info('Snapshot deleted from S3', { key });
  }

  /**
   * Store snapshot locally in archives/ directory.
   */
  private async storeLocally(
    snapshotPath: string,
    jsonString: string,
    hash: string,
    encryptionKey?: Buffer,
  ): Promise<string> {
    const localPath = path.join(this.localArchiveDir, snapshotPath, `${hash}.snapshot`);
    const localDir = path.dirname(localPath);

    // Create directory if not exists
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const config = getTTLConfig();
    let data: string | Buffer = jsonString;

    if (config.snapshotEncryption && encryptionKey) {
      const { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(jsonString, encryptionKey);
      const metadata = JSON.stringify({ iv: iv.toString('hex'), authTag: authTag.toString('hex') });
      data = Buffer.concat([Buffer.from(metadata), Buffer.from('\n'), encrypted]);
    }

    fs.writeFileSync(localPath, data);
    logger.info('Snapshot stored locally', { localPath });
    return localPath;
  }

  /**
   * Retrieve snapshot stored locally.
   */
  private async retrieveLocally(snapshotPath: string, encryptionKey?: Buffer): Promise<Record<string, any>> {
    const localPath = path.join(this.localArchiveDir, snapshotPath);

    if (!fs.existsSync(localPath)) {
      throw new Error(`Snapshot not found at ${localPath}`);
    }

    const data = fs.readFileSync(localPath);
    let jsonString: string;

    const config = getTTLConfig();
    if (config.snapshotEncryption && encryptionKey) {
      const lines = data.toString('utf-8').split('\n');
      const metadata = JSON.parse(lines[0]);
      const iv = Buffer.from(metadata.iv, 'hex');
      const authTag = Buffer.from(metadata.authTag, 'hex');
      const encrypted = Buffer.concat(lines.slice(1).map((line) => Buffer.from(line, 'utf-8')));
      jsonString = SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey);
    } else {
      jsonString = data.toString('utf-8');
    }

    return JSON.parse(jsonString);
  }

  /**
   * Delete snapshot stored locally.
   */
  private async deleteLocally(snapshotPath: string): Promise<void> {
    const localPath = path.join(this.localArchiveDir, snapshotPath);

    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      logger.info('Snapshot deleted locally', { localPath });
    }
  }
}
