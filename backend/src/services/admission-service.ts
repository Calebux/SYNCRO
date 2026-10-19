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

// ─── Constants ────────────────────────────────────────────────────────────

const BUDGET_VIOLATION_THRESHOLD = 0.95; // Warn at 95% of budget

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
}

export const admissionService = AdmissionService.getInstance();
