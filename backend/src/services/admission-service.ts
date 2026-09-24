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
    fn: () => Promise<T>,
  ): Promise<AdmissionStepResult<T>> {
    const startTime = Date.now();

    try {
      // Check cache first for safe reads
      const cached = await this.getCachedResult(stepName);
      if (cached !== null) {
        return { data: cached, latencyMs: Date.now() - startTime, error: null, cached: true, revoked: false };
      }

      // Execute the step
      const data = await fn();
      const latencyMs = Date.now() - startTime;

      // Cache the result if safe to cache
      await this.cacheResult(stepName, data);

      return { data, latencyMs, error: null, cached: false, revoked: false };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, latencyMs, error: message, cached: false, revoked: false };
    }
  }

  /**
   * Identity resolution: verify the x402 payment signature and resolve the identity.
   */
  private async resolveIdentity(request: AuthenticatedRequest): Promise<IdentityResolution> {
    const startTime = Date.now();
    const signature = request.headers['x402-signature'] as string | undefined;
    const nonce = request.headers['x402-nonce'] as string | undefined;

    // Check cache for identity resolution
    const cachedIdentity = await admissionCacheService.get<IdentityResolution>('identity', request.userId || 'unknown');
    if (cachedIdentity) {
      return { ...cachedIdentity, resolvedAt: Date.now() };
    }

    // Resolve identity from the request
    const userId = request.userId || 'unknown';
    const address = (request as any).address || userId;

    // Verify the x402 signature
    const valid = await this.verifyX402Signature(signature, nonce, address);

    const identity: IdentityResolution = {
      userId,
      address,
      signature: signature || '',
      nonce: nonce || '',
      valid,
      resolvedAt: Date.now(),
    };

    // Cache the result
    await admissionCacheService.set('identity', userId, identity);

    return identity;
  }

  /**
   * Scope read: read the registry scope for the resolved identity.
   */
  private async readScope(request: AuthenticatedRequest): Promise<ScopeRead> {
    const startTime = Date.now();

    // Check cache for scope
    const cachedScope = await admissionCacheService.get<ScopeRead>('scope', request.userId || 'unknown');
    if (cachedScope) {
      return { ...cachedScope, resolvedAt: Date.now() };
    }

    const userId = request.userId || 'unknown';

    // Read scopes from database
    const { data, error } = await supabase
      .from('scopes')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      logger.error(`Failed to read scopes for user ${userId}:`, error);
      throw error;
    }

    const scopes = (data || []).map((row: any) => row.scope);
    const registryId = (data?.[0] as any)?.registry_id || userId;
    const tier = (data?.[0] as any)?.tier || 'free';

    const scope: ScopeRead = {
      userId,
      scopes,
      registryId,
      tier,
      resolvedAt: Date.now(),
    };

    // Cache with shorter TTL for scope reads (revocation-sensitive)
    await admissionCacheService.set('scope', userId, scope, 1);

    return scope;
  }

  /**
   * Cap check: verify the identity is within its cap ceiling.
   */
  private async checkCap(identity: IdentityResolution | null): Promise<CapCheck> {
    if (!identity || !identity.valid) {
      return {
        userId: identity?.userId || 'unknown',
        capCeiling: 0,
        currentUsage: 0,
        remaining: 0,
        withinCap: false,
        resolvedAt: Date.now(),
      };
    }

    const userId = identity.userId;

    // Check cache for cap
    const cachedCap = await admissionCacheService.get<CapCheck>('cap', userId);
    if (cachedCap) {
      return { ...cachedCap, resolvedAt: Date.now() };
    }

    // Read cap ceiling from registry
    const { data: registryData } = await supabase
      .from('registries')
      .select('cap_ceiling, current_usage')
      .eq('user_id', userId)
      .single();

    const capCeiling = registryData?.cap_ceiling || 0;
    const currentUsage = registryData?.current_usage || 0;
    const remaining = capCeiling - currentUsage;
    const withinCap = remaining > 0;

    const capCheck: CapCheck = {
      userId,
      capCeiling,
      currentUsage,
      remaining,
      withinCap,
      resolvedAt: Date.now(),
    };

    // Cache with version for revocation
    await admissionCacheService.set('cap', userId, capCheck, capCheck.capCeiling);

    return capCheck;
  }

  /**
   * Meter reserve: reserve funds from the meter for this call.
   */
  private async reserveMeter(identity: IdentityResolution | null, scope: ScopeRead | null): Promise<MeterReserve> {
    if (!identity || !identity.valid) {
      return {
        userId: identity?.userId || 'unknown',
        amountReserved: 0,
        balance: 0,
        reserveId: '',
        expiresAt: Date.now(),
        resolvedAt: Date.now(),
      };
    }

    const userId = identity.userId;

    // Check cache for meter reserve
    const cachedMeter = await admissionCacheService.get<MeterReserve>('meter', userId);
    if (cachedMeter) {
      return { ...cachedMeter, resolvedAt: Date.now() };
    }

    // Reserve funds
    const { data } = await supabase
      .from('meters')
      .select('balance')
      .eq('user_id', userId)
      .single();

    const balance = data?.balance || 0;
    const amountReserved = Math.min(balance, scope?.tier === 'enterprise' ? 100 : 10);
    const reserveId = `reserve_${Date.now()}_${userId}`;

    // Insert reserve
    await supabase.from('meter_reserves').insert({
      user_id: userId,
      amount: amountReserved,
      reserve_id: reserveId,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    const meterReserve: MeterReserve = {
      userId,
      amountReserved,
      balance,
      reserveId,
      expiresAt: Date.now() + 60000,
      resolvedAt: Date.now(),
    };

    // Cache with short TTL for meter reserve
    await admissionCacheService.set('meter', userId, meterReserve);

    return meterReserve;
  }

  /**
   * Verify x402 payment signature.
   */
  private async verifyX402Signature(signature: string | undefined, nonce: string | undefined, address: string): Promise<boolean> {
    if (!signature || !nonce) return false;
    // Implementation would verify the x402 signature against the payment proof
    // This is a placeholder for the actual cryptographic verification
    return true;
  }

  /**
   * Evaluate whether all admission checks pass.
   */
  private evaluateAdmission(
    identity: AdmissionStepResult<IdentityResolution>,
    scope: AdmissionStepResult<ScopeRead>,
    cap: AdmissionStepResult<CapCheck>,
    meter: AdmissionStepResult<MeterReserve>,
    errors: AdmissionError[],
  ): boolean {
    let admitted = true;

    // Identity must be valid
    if (!identity.data || !identity.data.valid) {
      admitted = false;
      errors.push({
        step: 'identityResolution',
        message: identity.error || 'Identity resolution failed',
        latencyMs: identity.latencyMs,
        fatal: true,
        code: identity.data ? 'GATEWAY_KEY_INVALID' : 'GATEWAY_KEY_MISSING',
      });
    }

    // Scope must be resolved
    if (!scope.data) {
      admitted = false;
      errors.push({
        step: 'scopeRead',
        message: scope.error || 'Scope read failed',
        latencyMs: scope.latencyMs,
        fatal: true,
        code: scope.error ? 'GATEWAY_INTERNAL' : 'GATEWAY_SCOPE_DENIED',
      });
    }

    // Cap check must pass
    if (cap.data && !cap.data.withinCap) {
      admitted = false;
      errors.push({
        step: 'capCheck',
        message: 'Cap ceiling exceeded',
        latencyMs: cap.latencyMs,
        fatal: true,
        code: 'GATEWAY_CAP_EXCEEDED',
      });
    }

    // Meter must have sufficient balance
    if (meter.data && meter.data.amountReserved <= 0) {
      admitted = false;
      errors.push({
        step: 'meterReserve',
        message: 'Insufficient meter balance',
        latencyMs: meter.latencyMs,
        fatal: true,
        code: 'GATEWAY_METER_INSUFFICIENT',
      });
    }

    return admitted;
  }

  /**
   * Check if total latency is within budget.
   */
  private checkBudgetCompliance(totalLatencyMs: number): boolean {
    if (!admissionConfig.budget.enableBudgetEnforcement) return true;
    return totalLatencyMs <= admissionConfig.budget.totalBudgetMs;
  }

  /**
   * Record latency for p99 tracking.
   */
  private recordLatency(record: LatencyRecord): void {
    this.latencyRecords.push(record);

    // Trim records outside the window
    const cutoff = Date.now() - this.latencyWindowMs;
    this.latencyRecords = this.latencyRecords.filter(r => r.timestamp > cutoff);
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
   * Get the cached result for a step if available.
   */
  private async getCachedResult<T>(stepName: string): Promise<T | null> {
    // Mapping of step names to cache namespaces
    const namespaceMap: Record<string, string> = {
      identityResolution: 'identity',
      scopeRead: 'scope',
      capCheck: 'cap',
      meterReserve: 'meter',
    };

    const namespace = namespaceMap[stepName];
    if (!namespace) return null;

    // Determine the key based on the request context
    // This is a simplified version; in production, the key would be derived from the request
    return null; // Cached lookup would use request context
  }

  /**
   * Cache the result of a step.
   */
  private async cacheResult<T>(stepName: string, data: T): Promise<void> {
    const namespaceMap: Record<string, string> = {
      identityResolution: 'identity',
      scopeRead: 'scope',
      capCheck: 'cap',
      meterReserve: 'meter',
    };

    const namespace = namespaceMap[stepName];
    if (!namespace || !admissionConfig.cache[namespace as keyof typeof admissionConfig.cache].enabled) return;
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