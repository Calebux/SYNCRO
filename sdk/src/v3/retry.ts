import { randomUUID } from "node:crypto";
import { GatewaySdkError } from "../generated/gateway-errors.js";

export interface RetryRuntime {
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface DefaultRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  maxTotalDurationMs?: number;
}

export interface RetryAttemptContext {
  attempt: number;
  idempotencyKey: string;
}

export interface LogicalCallOptions {
  idempotencyKey?: string;
}

export class IdempotencyKeyReuseError extends Error {
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used for another logical call.`);
    this.name = "IdempotencyKeyReuseError";
  }
}

const DEFAULT_POLICY: Required<DefaultRetryPolicy> = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  maxTotalDurationMs: 10_000,
};

function computeJitteredDelay(
  attempt: number,
  policy: Required<DefaultRetryPolicy>,
  randomValue: number,
): number {
  const base = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  const jitter = base * policy.jitterRatio * randomValue;
  return Math.round(base + jitter);
}

function resolveRetryDelay(error: unknown): number | null {
  if (error instanceof GatewaySdkError) {
    if (!error.retryable) return null;
    if (typeof error.retryAfterMs === "number") return error.retryAfterMs;
    return null;
  }
  return null;
}

export class LogicalCallManager {
  private readonly usedKeys = new Set<string>();
  private readonly runtime: Required<RetryRuntime>;
  private readonly policy: Required<DefaultRetryPolicy>;

  constructor(policy: DefaultRetryPolicy = {}, runtime: RetryRuntime = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.runtime = {
      nowMs: runtime.nowMs ?? (() => Date.now()),
      sleepMs: runtime.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
      random: runtime.random ?? (() => Math.random()),
    };
  }

  beginLogicalCall(options: LogicalCallOptions = {}): string {
    const key = options.idempotencyKey ?? randomUUID();
    if (this.usedKeys.has(key)) {
      throw new IdempotencyKeyReuseError(key);
    }
    this.usedKeys.add(key);
    return key;
  }

  async executeWithRetry<T>(
    operation: (context: RetryAttemptContext) => Promise<T>,
    options: LogicalCallOptions = {},
  ): Promise<T> {
    const idempotencyKey = this.beginLogicalCall(options);
    const started = this.runtime.nowMs();
    let lastError: unknown;

    for (let attempt = 0; attempt < this.policy.maxAttempts; attempt++) {
      try {
        return await operation({ attempt, idempotencyKey });
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt >= this.policy.maxAttempts - 1;
        if (isLastAttempt) {
          break;
        }

        let delay = resolveRetryDelay(error);
        if (delay === null) {
          delay = computeJitteredDelay(attempt, this.policy, this.runtime.random());
        }

        const elapsed = this.runtime.nowMs() - started;
        if (elapsed + delay > this.policy.maxTotalDurationMs) {
          break;
        }

        await this.runtime.sleepMs(delay);
      }
    }

    throw lastError;
  }
}
