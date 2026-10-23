import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../utils/logger';

const logger = getLogger('ttl-config');

/**
 * Time unit enum for configuration durations.
 */
enum TimeUnit {
  Seconds = 'seconds',
  Minutes = 'minutes',
  Hours = 'hours',
  Days = 'days',
}

/**
 * Snapshot storage backend options.
 */
enum SnapshotStorageBackend {
  S3 = 's3',
  IPFS = 'ipfs',
  Local = 'local',
}

/**
 * Audit logging verbosity level.
 */
enum AuditLevel {
  Minimal = 'minimal',
  Standard = 'standard',
  Full = 'full',
}

/**
 * TTL configuration schema for validation.
 */
const ttlConfigSchema = z.object({
  bumpThreshold: z.number().positive().describe('Remaining days before expiration to trigger bump eligibility'),
  bumpThresholdUnit: z.nativeEnum(TimeUnit).default(TimeUnit.Days),
  defaultTtlExtension: z.number().positive().describe('Days to add to TTL when bumping'),
  defaultTtlExtensionUnit: z.nativeEnum(TimeUnit).default(TimeUnit.Days),
  minBumpInterval: z.number().positive().describe('Minimum hours between bumps for same entry'),
  minBumpIntervalUnit: z.nativeEnum(TimeUnit).default(TimeUnit.Hours),
  archivalGracePeriod: z.number().positive().describe('Days after expiration to wait before archival'),
  archivalGracePeriodUnit: z.nativeEnum(TimeUnit).default(TimeUnit.Days),
  archivalRetentionWindow: z.number().positive().describe('Days to retain off-chain snapshots after archival'),
  archivalRetentionWindowUnit: z.nativeEnum(TimeUnit).default(TimeUnit.Days),
  batchSize: z.number().positive().describe('Max entries to process per worker run'),
  maxGasPerBatch: z.number().positive().describe('Max cumulative gas per batch'),
  workerSchedule: z.string().describe('Cron schedule for TTL bump worker'),
  archivalSchedule: z.string().describe('Cron schedule for archival worker'),
  snapshotStorage: z.nativeEnum(SnapshotStorageBackend).default(SnapshotStorageBackend.S3),
  snapshotBucket: z.string().describe('S3 bucket or IPFS namespace for snapshots'),
  snapshotEncryption: z.boolean().default(true).describe('Encrypt snapshots at rest'),
  redactSensitiveFields: z.boolean().default(true).describe('Redact PII in snapshots'),
  auditLevel: z.nativeEnum(AuditLevel).default(AuditLevel.Full),
  retryMaxAttempts: z.number().positive().default(5).describe('Max retries for transient failures'),
  retryBackoffMs: z.number().positive().default(1000).describe('Initial backoff (ms) for exponential retry'),
  rateLimitPerEntry: z.object({
    bumpsPerDay: z.number().positive().default(2),
    archivals: z.number().positive().default(1),
  }),
  features: z.object({
    enableTtlBumping: z.boolean().default(true).describe('Enable TTL bump worker'),
    enableArchival: z.boolean().default(true).describe('Enable archival worker'),
    enableAutoDelete: z.boolean().default(false).describe('Enable automatic deletion of archived entries'),
    dryRun: z.boolean().default(false).describe('Run workers in dry-run mode (no on-chain calls)'),
  }).optional(),
});

export type TTLConfig = z.infer<typeof ttlConfigSchema>;

/**
 * Convert a duration value and unit to milliseconds.
 */
function toMilliseconds(value: number, unit: TimeUnit): number {
  switch (unit) {
    case TimeUnit.Seconds:
      return value * 1000;
    case TimeUnit.Minutes:
      return value * 60 * 1000;
    case TimeUnit.Hours:
      return value * 60 * 60 * 1000;
    case TimeUnit.Days:
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

/**
 * Convert a duration value and unit to seconds.
 */
function toSeconds(value: number, unit: TimeUnit): number {
  return toMilliseconds(value, unit) / 1000;
}

/**
 * Computed TTL configuration with derived values.
 */
export class ComputedTTLConfig {
  private config: TTLConfig;

  constructor(config: TTLConfig) {
    this.config = config;
  }

  // Bump thresholds (in milliseconds)
  get bumpThresholdMs(): number {
    return toMilliseconds(this.config.bumpThreshold, this.config.bumpThresholdUnit as TimeUnit);
  }

  get bumpThresholdSeconds(): number {
    return toSeconds(this.config.bumpThreshold, this.config.bumpThresholdUnit as TimeUnit);
  }

  // TTL extension (in milliseconds)
  get defaultTtlExtensionMs(): number {
    return toMilliseconds(this.config.defaultTtlExtension, this.config.defaultTtlExtensionUnit as TimeUnit);
  }

  get defaultTtlExtensionSeconds(): number {
    return toSeconds(this.config.defaultTtlExtension, this.config.defaultTtlExtensionUnit as TimeUnit);
  }

  // Bump interval (in milliseconds)
  get minBumpIntervalMs(): number {
    return toMilliseconds(this.config.minBumpInterval, this.config.minBumpIntervalUnit as TimeUnit);
  }

  get minBumpIntervalSeconds(): number {
    return toSeconds(this.config.minBumpInterval, this.config.minBumpIntervalUnit as TimeUnit);
  }

  // Archival grace period (in milliseconds)
  get archivalGracePeriodMs(): number {
    return toMilliseconds(this.config.archivalGracePeriod, this.config.archivalGracePeriodUnit as TimeUnit);
  }

  get archivalGracePeriodSeconds(): number {
    return toSeconds(this.config.archivalGracePeriod, this.config.archivalGracePeriodUnit as TimeUnit);
  }

  // Archival retention window (in milliseconds)
  get archivalRetentionWindowMs(): number {
    return toMilliseconds(this.config.archivalRetentionWindow, this.config.archivalRetentionWindowUnit as TimeUnit);
  }

  get archivalRetentionWindowSeconds(): number {
    return toSeconds(this.config.archivalRetentionWindow, this.config.archivalRetentionWindowUnit as TimeUnit);
  }

  // Batch parameters
  get batchSize(): number {
    return this.config.batchSize;
  }

  get maxGasPerBatch(): number {
    return this.config.maxGasPerBatch;
  }

  // Scheduling
  get workerSchedule(): string {
    return this.config.workerSchedule;
  }

  get archivalSchedule(): string {
    return this.config.archivalSchedule;
  }

  // Snapshot storage
  get snapshotStorage(): SnapshotStorageBackend {
    return this.config.snapshotStorage as SnapshotStorageBackend;
  }

  get snapshotBucket(): string {
    return this.config.snapshotBucket;
  }

  get snapshotEncryption(): boolean {
    return this.config.snapshotEncryption;
  }

  get redactSensitiveFields(): boolean {
    return this.config.redactSensitiveFields;
  }

  // Audit
  get auditLevel(): AuditLevel {
    return this.config.auditLevel as AuditLevel;
  }

  // Retry
  get retryMaxAttempts(): number {
    return this.config.retryMaxAttempts;
  }

  get retryBackoffMs(): number {
    return this.config.retryBackoffMs;
  }

  // Rate limiting
  get bumpsPerDay(): number {
    return this.config.rateLimitPerEntry.bumpsPerDay;
  }

  get archivals(): number {
    return this.config.rateLimitPerEntry.archivals;
  }

  // Features
  get enableTtlBumping(): boolean {
    return this.config.features?.enableTtlBumping ?? true;
  }

  get enableArchival(): boolean {
    return this.config.features?.enableArchival ?? true;
  }

  get enableAutoDelete(): boolean {
    return this.config.features?.enableAutoDelete ?? false;
  }

  get dryRun(): boolean {
    return this.config.features?.dryRun ?? false;
  }

  /**
   * Get the raw configuration object.
   */
  getRawConfig(): TTLConfig {
    return this.config;
  }

  /**
   * Get a summary of the configuration for logging.
   */
  getSummary(): Record<string, any> {
    return {
      bumpThreshold: `${this.config.bumpThreshold}${this.config.bumpThresholdUnit}`,
      defaultTtlExtension: `${this.config.defaultTtlExtension}${this.config.defaultTtlExtensionUnit}`,
      minBumpInterval: `${this.config.minBumpInterval}${this.config.minBumpIntervalUnit}`,
      archivalGracePeriod: `${this.config.archivalGracePeriod}${this.config.archivalGracePeriodUnit}`,
      archivalRetentionWindow: `${this.config.archivalRetentionWindow}${this.config.archivalRetentionWindowUnit}`,
      batchSize: this.config.batchSize,
      maxGasPerBatch: this.config.maxGasPerBatch,
      workerSchedule: this.config.workerSchedule,
      archivalSchedule: this.config.archivalSchedule,
      snapshotStorage: this.config.snapshotStorage,
      snapshotEncryption: this.config.snapshotEncryption,
      redactSensitiveFields: this.config.redactSensitiveFields,
      auditLevel: this.config.auditLevel,
      features: this.config.features,
    };
  }
}

/**
 * Load TTL configuration from file and environment variables.
 * Env variables override config file values.
 *
 * @returns ComputedTTLConfig instance with configuration values.
 */
export function loadTTLConfig(): ComputedTTLConfig {
  try {
    const configPath = path.resolve(__dirname, '../../config/ttl.json');
    let configObj: any = {};

    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(configFile);
      configObj = parsed.ttl || parsed;
      logger.info(`Loaded TTL configuration from ${configPath}`);
    } else {
      logger.warn(`TTL configuration file not found at ${configPath}; using defaults`);
    }

    // Override with environment variables
    if (process.env.TTL_BUMP_THRESHOLD_DAYS) {
      configObj.bumpThreshold = parseInt(process.env.TTL_BUMP_THRESHOLD_DAYS, 10);
    }
    if (process.env.TTL_DEFAULT_EXTENSION_DAYS) {
      configObj.defaultTtlExtension = parseInt(process.env.TTL_DEFAULT_EXTENSION_DAYS, 10);
    }
    if (process.env.TTL_MIN_BUMP_INTERVAL_HOURS) {
      configObj.minBumpInterval = parseInt(process.env.TTL_MIN_BUMP_INTERVAL_HOURS, 10);
    }
    if (process.env.TTL_ARCHIVAL_GRACE_PERIOD_DAYS) {
      configObj.archivalGracePeriod = parseInt(process.env.TTL_ARCHIVAL_GRACE_PERIOD_DAYS, 10);
    }
    if (process.env.TTL_ARCHIVAL_RETENTION_WINDOW_DAYS) {
      configObj.archivalRetentionWindow = parseInt(process.env.TTL_ARCHIVAL_RETENTION_WINDOW_DAYS, 10);
    }
    if (process.env.TTL_BATCH_SIZE) {
      configObj.batchSize = parseInt(process.env.TTL_BATCH_SIZE, 10);
    }
    if (process.env.TTL_MAX_GAS_PER_BATCH) {
      configObj.maxGasPerBatch = parseInt(process.env.TTL_MAX_GAS_PER_BATCH, 10);
    }
    if (process.env.TTL_WORKER_SCHEDULE) {
      configObj.workerSchedule = process.env.TTL_WORKER_SCHEDULE;
    }
    if (process.env.TTL_ARCHIVAL_SCHEDULE) {
      configObj.archivalSchedule = process.env.TTL_ARCHIVAL_SCHEDULE;
    }
    if (process.env.TTL_SNAPSHOT_STORAGE) {
      configObj.snapshotStorage = process.env.TTL_SNAPSHOT_STORAGE;
    }
    if (process.env.TTL_SNAPSHOT_BUCKET) {
      configObj.snapshotBucket = process.env.TTL_SNAPSHOT_BUCKET;
    }
    if (process.env.TTL_SNAPSHOT_ENCRYPTION !== undefined) {
      configObj.snapshotEncryption = process.env.TTL_SNAPSHOT_ENCRYPTION === 'true';
    }
    if (process.env.TTL_REDACT_SENSITIVE_FIELDS !== undefined) {
      configObj.redactSensitiveFields = process.env.TTL_REDACT_SENSITIVE_FIELDS === 'true';
    }
    if (process.env.TTL_AUDIT_LEVEL) {
      configObj.auditLevel = process.env.TTL_AUDIT_LEVEL;
    }
    if (process.env.TTL_DRY_RUN !== undefined) {
      configObj.features = configObj.features || {};
      configObj.features.dryRun = process.env.TTL_DRY_RUN === 'true';
    }

    // Validate configuration
    const validated = ttlConfigSchema.parse(configObj);
    logger.info('TTL configuration validated', { summary: new ComputedTTLConfig(validated).getSummary() });

    return new ComputedTTLConfig(validated);
  } catch (error) {
    logger.error('Failed to load TTL configuration', { error });
    throw error;
  }
}

/**
 * Get the TTL configuration singleton.
 */
let cachedConfig: ComputedTTLConfig | null = null;

export function getTTLConfig(): ComputedTTLConfig {
  if (!cachedConfig) {
    cachedConfig = loadTTLConfig();
  }
  return cachedConfig;
}

/**
 * Reset the TTL configuration cache (for testing).
 */
export function resetTTLConfig(): void {
  cachedConfig = null;
}

export { TimeUnit, SnapshotStorageBackend, AuditLevel };
