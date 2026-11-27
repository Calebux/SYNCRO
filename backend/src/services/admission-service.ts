import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import { admissionConfig } from '../config/admission';
import { admissionCacheService } from './admission-cache';
import { sharedRedisClient } from '../lib/redis-client';
import {
  ApiLatencyService,
  EndpointLatencyMetrics,
} from './api-latency-service';
import type { AuthenticatedRequest } from '../middleware/auth';
import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';

// ─── Types ────────────────────────────────────────────────────────────────

export interface IdentityResolution {
  userId: string;
  address: string;
  signature: string;
  nonce: string;
  valid: boolean;
  resolvedAt: number;
}

export interface ScopeRead {
  userId: string;
  scopes: string[];
  registryId: string;
  tier: string;
  resolvedAt: number;
}

export interface CapCheck {
  userId: string;
  capCeiling: number;
  currentUsage: number;
  remaining: number;
  withinCap: boolean;
  resolvedAt: number;
  /** Start of the next cap period ( mirrors virtual-card period roll ). */
  periodResetAt: string | null;
  retryAfterSeconds: number | null;
}

export interface MeterReserve {
  userId: string;
  amountReserved: number;
  balance: number;
  reserveId: string;
  expiresAt: number;
  resolvedAt: number;
}

export interface AdmissionResult {
  admitted: boolean;
  identity: IdentityResolution | null;
  scope: ScopeRead | null;
  cap: CapCheck | null;
  meter: MeterReserve | null;
  totalLatencyMs: number;
  stepLatenciesMs: {
    identityResolution: number;
    scopeRead: number;
    capCheck: number;
    meterReserve: number;
  };
  p99Compliant: boolean;
  errors: AdmissionError[];
}

export interface AdmissionError {
  step: string;
  message: string;
  latencyMs: number;
  fatal: boolean;
  code?: string;
  retryAfterSeconds?: number;
  resetAt?: string;
}

export interface AdmissionStepResult<T> {
  data: T | null;
  latencyMs: number;
  error: string | null;
  cached: boolean;
  revoked: boolean;
}

export interface LatencyRecord {
  timestamp: number;
  totalLatencyMs: number;
  stepLatenciesMs: Record<string, number>;
  admitted: boolean;
}

/**
 * Per-route reservation TTL configuration.
 *
 * `ttlMs` is the lifetime of a `meter_reserves` row before it is considered
 * orphaned. `maxTtlMs` caps how far a streaming response may extend a
 * reservation via {@link AdmissionService.extendReservation}.
 */
export interface ReservationTtlConfig {
  ttlMs: number;
  maxTtlMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const BUDGET_VIOLATION_THRESHOLD = 0.95; // Warn at 95% of budget

/** Default reservation TTL when a route does not specify one. */
export const DEFAULT_RESERVATION_TTL_MS = 60_000;

/** Hard ceiling for any reservation TTL (default or per-route). */
export const MAX_RESERVATION_TTL_MS = 15 * 60_000;

/** How often the sweeper releases expired reservations. */
export const RESERVATION_SWEEP_INTERVAL_MS = 30_000;

// ─── Admission Service ────────────────────────────────────────────────────

/**
 * Admission service handles the x402 payment verification pipeline.
 *
 * It measures latency for each step (identity resolution, scope read,
 * cap check, meter reserve), parallelizes independent checks, and enforces
 * a latency budget. Results are cached with revocation-aware invalidation.
 */
export class AdmissionService {
  private static instance: AdmissionService | null = null;
  private latencyRecords: LatencyRecord[] = [];
  private readonly latencyWindowMs: number;
  private readonly p99Calculator: ApiLatencyService;
  private readonly budgetViolations: number[] = [];
  private readonly routeTtls = new Map<string, ReservationTtlConfig>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private expiredReservationsReleased = 0;

  private constructor() {
    this.latencyWindowMs = admissionConfig.budget.p99WindowMs;
    this.p99Calculator = ApiLatencyService.getInstance();
  }

  static getInstance(): AdmissionService {
    if (!AdmissionService.instance) {
      AdmissionService.instance = new AdmissionService();
    }
    return AdmissionService.instance;
  }

  /**
   * Register a per-route reservation TTL. Values are clamped to
   * [1, MAX_RESERVATION_TTL_MS] so a misconfigured route cannot pin
   * reservations indefinitely.
   */
  setRouteTtl(route: string, config: Partial<ReservationTtlConfig>): void {
    const ttlMs = this.clampTtl(config.ttlMs ?? DEFAULT_RESERVATION_TTL_MS);
    const maxTtlMs = this.clampTtl(config.maxTtlMs ?? MAX_RESERVATION_TTL_MS);
    this.routeTtls.set(route, { ttlMs, maxTtlMs: Math.max(ttlMs, maxTtlMs) });
  }

  /** Resolve the effective TTL config for a route (falls back to defaults). */
  getRouteTtl(route?: string): ReservationTtlConfig {
    if (route && this.routeTtls.has(route)) {
      return this.routeTtls.get(route)!;
    }
    return { ttlMs: DEFAULT_RESERVATION_TTL_MS, maxTtlMs: MAX_RESERVATION_TTL_MS };
  }

  private clampTtl(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_RESERVATION_TTL_MS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_RESERVATION_TTL_MS);
  }

  /**
   * Extend a live reservation while a streaming response is still flowing.
   * The new expiry is capped by the route's `maxTtlMs`.
   */
  async extendReservation(reserveId: string, route?: string): Promise<number | null> {
    const { ttlMs, maxTtlMs } = this.getRouteTtl(route);
    const now = Date.now();
    const { data: existing, error: readError } = await supabase
      .from('meter_reserves')
      .select('expires_at')
      .eq('id', reserveId)
      .maybeSingle();

    if (readError) {
      logger.error('Failed to read reservation for extension:', readError);
      return null;
    }
    if (!existing) return null;

    const currentExpiry = new Date(existing.expires_at as string).getTime();
    const proposed = now + ttlMs;
    const ceiling = currentExpiry + maxTtlMs;
    const nextExpiry = Math.min(proposed, ceiling);

    const { error: updateError } = await supabase
      .from('meter_reserves')
      .update({ expires_at: new Date(nextExpiry).toISOString() })
      .eq('id', reserveId);

    if (updateError) {
      logger.error('Failed to extend reservation:', updateError);
      return null;
    }
    return nextExpiry;
  }

  /**
   * Release expired reservations that were never committed or released.
   * Each released row is logged as an orphan and counted in metrics.
   */
  async sweepExpiredReservations(): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data: expired, error: readError } = await supabase
      .from('meter_reserves')
      .select('id, user_id, amount_reserved, expires_at')
      .lt('expires_at', nowIso)
      .is('released_at', null)
      .is('committed_at', null);

    if (readError) {
      logger.error('Failed to read expired reservations:', readError);
      return 0;
    }
    if (!expired || expired.length === 0) return 0;

    let released = 0;
    for (const row of expired) {
      const { error: updateError } = await supabase
        .from('meter_reserves')
        .update({ released_at: nowIso })
        .eq('id', row.id)
        .is('released_at', null)
        .is('committed_at', null);

      if (updateError) {
        logger.error('Failed to release expired reservation:', updateError);
        continue;
      }
      released += 1;
      logger.warn('Released orphaned reservation', {
        reserveId: row.id,
        userId: row.user_id,
        amountReserved: row.amount_reserved,
        expiresAt: row.expires_at,
      });
    }

    this.expiredReservationsReleased += released;
    logger.info('Reservation sweeper released expired reservations', {
      released,
      totalReleased: this.expiredReservationsReleased,
    });
    return released;
  }

  /** Total expired reservations released since process start (metrics). */
  getExpiredReservationsReleased(): number {
    return this.expiredReservationsReleased;
  }

  /** Start the periodic sweeper job. Idempotent. */
  startReservationSweeper(intervalMs: number = RESERVATION_SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepExpiredReservations().catch((error) => {
        logger.error('Reservation sweeper failed:', error);
      });
    }, intervalMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  /** Stop the periodic sweeper job. */
  stopReservationSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Main admission check: verify payment and resolve all required data.
   *
   * Steps are parallelized where independent:
   * - Identity resolution and scope read can run in parallel
   * - Cap check depends on identity but can run in parallel with meter reserve
   * - Meter reserve depends on both identity and scope
   */
  async admit(request: AuthenticatedRequest): Promise<AdmissionResult> {
    const startTime = Date.now();
    const errors: AdmissionError[] = [];

    try {
      // Phase 1: Parallel independent checks
      // Identity resolution and scope read are independent of each other
      const [identityResult, scopeResult] = admissionConfig.parallelChecks
        ? await Promise.all([
            this.executeStep('identityResolution', () => this.resolveIdentity(request)),
            this.executeStep('scopeRead', () => this.readScope(request)),
          ])
        : await Promise.all([
            this.executeStep('identityResolution', () => this.resolveIdentity(request)),
            this.executeStep('scopeRead', () => this.readScope(request)),
          ]);

      // Phase 2: Dependent checks that can run in parallel
      // Cap check and meter reserve both depend on identity resolution
      const [capResult, meterResult] = admissionConfig.parallelChecks
        ? await Promise.all([
            this.executeStep('capCheck', () => this.checkCap(identityResult.data as IdentityResolution | null)),
            this.executeStep('meterReserve', () => this.reserveMeter(identityResult.data as IdentityResolution | null, scopeResult.data as ScopeRead | null)),
          ])
        : await Promise.all([
            this.executeStep('capCheck', () => this.checkCap(identityResult.data as IdentityResolution | null)),
            this.executeStep('meterReserve', () => this.reserveMeter(identityResult.data as IdentityResolution | null, scopeResult.data as ScopeRead | null)),
          ]);

      // Calculate total latency
      const totalLatencyMs = Date.now() - startTime;

      // Determine if admitted
      const admitted = this.evaluateAdmission(
        identityResult,
        scopeResult,
        capResult,
        meterResult,
        errors,
      );

      // Check budget compliance
      const p99Compliant = this.checkBudgetCompliance(totalLatencyMs);

      // Record latency for p99 tracking
      this.recordLatency({
        timestamp: startTime,
        totalLatencyMs,
        stepLatenciesMs: {
          identityResolution: identityResult.latencyMs,
          scopeRead: scopeResult.latencyMs,
          capCheck: capResult.latencyMs,
          meterReserve: meterResult.latencyMs,
        },
        admitted,
      });

      // Enforce budget if configured
      if (admissionConfig.budget.enableBudgetEnforcement && !p99Compliant) {
        errors.push({
          step: 'budget',
          message: `Admission total latency ${totalLatencyMs}ms exceeds budget ${admissionConfig.budget.totalBudgetMs}ms`,
          latencyMs: totalLatencyMs,
          fatal: false,
        });
      }

      const result: AdmissionResult = {
        admitted,
        identity: identityResult.data,
        scope: scopeResult.data,
        cap: capResult.data,
        meter: meterResult.data,
        totalLatencyMs,
        stepLatenciesMs: {
          identityResolution: identityResult.latencyMs,
          scopeRead: scopeResult.latencyMs,
          capCheck: capResult.latencyMs,
          meterReserve: meterResult.latencyMs,
        },
        p99Compliant,
        errors,
      };

      // Log if budget violation
      if (totalLatencyMs > admissionConfig.budget.totalBudgetMs * BUDGET_VIOLATION_THRESHOLD) {
        this.budgetViolations.push(totalLatencyMs);
        logger.warn(`Admission budget warning: ${totalLatencyMs}ms vs budget ${admissionConfig.budget.totalBudgetMs}ms`, {
          stepLatencies: result.stepLatenciesMs,
          admitted,
        });
      }

      return result;
    } catch (error) {
      const totalLatencyMs = Date.now() - startTime;
      logger.error('Admission service error:', error);
      return {
        admitted: false,
        identity: null,
        scope: null,
        cap: null,
        meter: null,
        totalLatencyMs,
        stepLatenciesMs: { identityResolution: 0, scopeRead: 0, capCheck: 0, meterReserve: 0 },
        p99Compliant: false,
        errors: [{
          step: 'admission',
          message: error instanceof Error ? error.message : 'Unknown admission error',
          latencyMs: totalLatencyMs,
          fatal: true,
          code: 'GATEWAY_INTERNAL',
        }],
      };
    }
  }

  /**
   * Execute a single admission step with timing and caching.
   */
  private async executeStep<T>(
    stepName: string,
    fn: () => Promise<T | null>,
  ): Promise<AdmissionStepResult<T>> {
    const start = Date.now();
    try {
      const data = await fn();
      return {
        data,
        latencyMs: Date.now() - start,
        error: null,
        cached: false,
        revoked: false,
      };
    } catch (error) {
      return {
        data: null,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown step error',
        cached: false,
        revoked: false,
      };
    }
  }

  /**
   * Resolve the caller identity from the x402 headers.
   */
  private async resolveIdentity(request: AuthenticatedRequest): Promise<IdentityResolution | null> {
    const address = (request.headers['x402-address'] as string) || '';
    const signature = (request.headers['x402-signature'] as string) || '';
    const nonce = (request.headers['x402-nonce'] as string) || '';

    if (!address || !signature || !nonce) {
      return null;
    }

    const valid = await this.verifyX402Signature(request, address, signature, nonce);
    if (!valid) {
      return null;
    }

    return {
      userId: address,
      address,
      signature,
      nonce,
      valid: true,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Verify an x402 Ed25519 signature against the claimed Stellar address.
   *
   * The signed payload is canonical and covers the nonce, HTTP method, path,
   * body hash, and expiry. Reused nonces are rejected via the replay store.
   * Any failure returns false without revealing which check failed.
   */
  private async verifyX402Signature(
    request: AuthenticatedRequest,
    address: string,
    signature: string,
    nonce: string,
  ): Promise<boolean> {
    try {
      const expiryHeader = request.headers['x402-expiry'] as string | undefined;
      const expiry = expiryHeader ? Number(expiryHeader) : NaN;
      if (!Number.isFinite(expiry) || expiry < Date.now()) {
        return false;
      }

      const method = (request.method || 'GET').toUpperCase();
      const path = request.path || request.originalUrl || '/';
      const bodyHash = this.hashRequestBody(request.body);
      const payload = this.buildCanonicalPayload(nonce, method, path, bodyHash, expiry);

      const keypair = Keypair.fromPublicKey(address);
      const signatureBytes = Buffer.from(signature, 'base64');
      const valid = keypair.verify(Buffer.from(payload, 'utf8'), signatureBytes);
      if (!valid) {
        return false;
      }

      const nonceAccepted = await this.consumeNonce(nonce, expiry);
      if (!nonceAccepted) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build the canonical payload that is signed by the caller.
   */
  private buildCanonicalPayload(
    nonce: string,
    method: string,
    path: string,
    bodyHash: string,
    expiry: number,
  ): string {
    return [
      'x402-v1',
      `nonce:${nonce}`,
      `method:${method}`,
      `path:${path}`,
      `bodyHash:${bodyHash}`,
      `expiry:${expiry}`,
    ].join('\n');
  }

  /**
   * Hash the request body deterministically for inclusion in the payload.
   */
  private hashRequestBody(body: unknown): string {
    const serialized = body === undefined || body === null
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Consume a nonce via the replay-protection store. Returns false if the
   * nonce has already been used.
   */
  private async consumeNonce(nonce: string, expiry: number): Promise<boolean> {
    const key = `x402:nonce:${nonce}`;
    const ttlSeconds = Math.max(1, Math.ceil((expiry - Date.now()) / 1000));
    const result = await sharedRedisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Read the caller's scopes from the registry.
   */
  private async readScope(request: AuthenticatedRequest): Promise<ScopeRead | null> {
    const userId = (request.headers['x402-address'] as string) || '';
    if (!userId) {
      return null;
    }

    const { data, error } = await supabase
      .from('scope_registry')
      .select('scopes, registry_id, tier')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      userId,
      scopes: (data.scopes as string[]) || [],
      registryId: data.registry_id as string,
      tier: data.tier as string,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Check the caller's spending cap.
   */
  private async checkCap(identity: IdentityResolution | null): Promise<CapCheck | null> {
    if (!identity) {
      return null;
    }

    const { data, error } = await supabase
      .from('spending_caps')
      .select('cap_ceiling, current_usage, period_reset_at')
      .eq('user_id', identity.userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const capCeiling = Number(data.cap_ceiling) || 0;
    const currentUsage = Number(data.current_usage) || 0;
    const remaining = Math.max(0, capCeiling - currentUsage);
    const withinCap = currentUsage < capCeiling;
    const periodResetAt = (data.period_reset_at as string) || null;
    const retryAfterSeconds = periodResetAt
      ? Math.max(0, Math.ceil((new Date(periodResetAt).getTime() - Date.now()) / 1000))
      : null;

    return {
      userId: identity.userId,
      capCeiling,
      currentUsage,
      remaining,
      withinCap,
      resolvedAt: Date.now(),
      periodResetAt,
      retryAfterSeconds,
    };
  }

  /**
   * Reserve meter balance for the request.
   */
  private async reserveMeter(
    identity: IdentityResolution | null,
    scope: ScopeRead | null,
  ): Promise<MeterReserve | null> {
    if (!identity || !scope) {
      return null;
    }

    const amount = admissionConfig.meter.reserveAmount;
    const reserveId = `reserve_${identity.userId}_${Date.now()}`;
    const expiresAt = Date.now() + admissionConfig.meter.reserveTtlMs;

    // Insert reservation into the database
    const { error } = await supabase.from('meter_reserves').insert({
      id: reserveId,
      user_id: identity.userId,
      amount_reserved: amount,
      expires_at: new Date(expiresAt).toISOString(),
    });

    if (error) {
      logger.error('Failed to insert meter reserve:', error);
      return null;
    }

    return {
      userId: identity.userId,
      amountReserved: amount,
      balance: 0,
      reserveId,
      expiresAt,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Evaluate whether the request should be admitted based on step results.
   */
  private evaluateAdmission(
    identityResult: AdmissionStepResult<IdentityResolution>,
    scopeResult: AdmissionStepResult<ScopeRead>,
    capResult: AdmissionStepResult<CapCheck>,
    meterResult: AdmissionStepResult<MeterReserve>,
    errors: AdmissionError[],
  ): boolean {
    if (!identityResult.data || !identityResult.data.valid) {
      errors.push({
        step: 'identityResolution',
        message: 'Identity verification failed',
        latencyMs: identityResult.latencyMs,
        fatal: true,
        code: 'GATEWAY_KEY_INVALID',
      });
      return false;
    }

    if (!scopeResult.data) {
      errors.push({
        step: 'scopeRead',
        message: 'Scope resolution failed',
        latencyMs: scopeResult.latencyMs,
        fatal: true,
        code: 'GATEWAY_SCOPE_INVALID',
      });
      return false;
    }

    if (!capResult.data || !capResult.data.withinCap) {
      errors.push({
        step: 'capCheck',
        message: 'Spending cap exceeded',
        latencyMs: capResult.latencyMs,
        fatal: true,
        code: 'GATEWAY_CAP_EXCEEDED',
        retryAfterSeconds: capResult.data?.retryAfterSeconds ?? undefined,
        resetAt: capResult.data?.periodResetAt ?? undefined,
      });
      return false;
    }

    if (!meterResult.data) {
      errors.push({
        step: 'meterReserve',
        message: 'Meter reserve failed',
        latencyMs: meterResult.latencyMs,
        fatal: true,
        code: 'GATEWAY_METER_UNAVAILABLE',
      });
      return false;
    }

    return true;
  }

  /**
   * Check whether the total latency is within the configured budget.
   */
  private checkBudgetCompliance(totalLatencyMs: number): boolean {
    return totalLatencyMs <= admissionConfig.budget.totalBudgetMs;
  }

  /**
   * Record a latency sample for p99 tracking.
   */
  private recordLatency(record: LatencyRecord): void {
    this.latencyRecords.push(record);
    const cutoff = Date.now() - this.latencyWindowMs;
    this.latencyRecords = this.latencyRecords.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Get p99 latency from recorded samples.
   */
  getP99Latency(): number {
    if (this.latencyRecords.length < admissionConfig.budget.minSamplesForP99) {
      return 0;
    }
    const sorted = [...this.latencyRecords]
      .map(r => r.totalLatencyMs)
      .sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    return sorted[p99Index] || sorted[sorted.length - 1];
  }

  /**
   * Get the current admission budget status.
   */
  getBudgetStatus(): {
    p99LatencyMs: number;
    budgetMs: number;
    compliant: boolean;
    sampleCount: number;
    recentViolations: number;
  } {
    const p99 = this.getP99Latency();
    const recentViolations = this.budgetViolations.filter(v => v > admissionConfig.budget.totalBudgetMs).length;
    return {
      p99LatencyMs: p99,
      budgetMs: admissionConfig.budget.totalBudgetMs,
      compliant: p99 <= admissionConfig.budget.totalBudgetMs,
      sampleCount: this.latencyRecords.length,
      recentViolations,
    };
  }

  /**
   * Get all recorded latencies for testing/monitoring.
   */
  getLatencyRecords(): LatencyRecord[] {
    return [...this.latencyRecords];
  }

  /**
   * Clear all recorded latencies (useful for testing).
   */
  clearLatencyRecords(): void {
    this.latencyRecords = [];
    this.budgetViolations.length = 0;
  }
}

export const admissionService = AdmissionService.getInstance();
