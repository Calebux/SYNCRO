/**
 * Spend budgets for the LLM email parser (issue #1281).
 *
 * `llm-parser.ts` used to call the model once per email with no visible budget,
 * so a user connecting a mailbox with thousands of messages triggered an
 * unbounded spend. This service enforces two hard cutoffs — one per user, one
 * global — over a rolling UTC day, warns once when a budget crosses its alert
 * threshold, and records token usage per scan so cost can be attributed.
 *
 * The in-process counters are the enforcement mechanism (they are synchronous
 * and cannot fail open on a DB outage). The `llm_usage_ledger` table is the
 * durable attribution record and is written fire-and-forget.
 */

import { supabase } from '../config/database';
import logger from '../config/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SpendDecision {
  allowed: boolean;
  /** Populated only when `allowed` is false. */
  reason?: 'user_budget_exhausted' | 'global_budget_exhausted';
  /** Remaining spend in the binding budget, in USD. */
  remainingUsd: number;
}

export interface BudgetSnapshot {
  day: string;
  globalSpendUsd: number;
  globalLimitUsd: number;
  userSpendUsd: number;
  userLimitUsd: number;
  alertThreshold: number;
}

export interface UsageContext {
  userId?: string;
  /** Rescan job id, so a single scan's cost can be totalled. */
  scanId?: string;
  promptVersion: string;
  model: string;
  cached?: boolean;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

/**
 * USD per 1M tokens. Gemini 1.5 Flash paid-tier rates for prompts under
 * 128k tokens. Deliberately a table rather than a single constant so a model
 * change does not silently invalidate every budget.
 */
const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
};

/** Used when a model has no pricing entry — deliberately pessimistic. */
const FALLBACK_PRICING = { inputPerMillion: 1.0, outputPerMillion: 3.0 };

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  return (
    (usage.promptTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMillion
  );
}

// ─── Configuration ───────────────────────────────────────────────────────────

import logger from '../config/logger';
import { env } from '../config/env';

function numberFromEnv(name: string, fallback: number): number {
  const raw = (env as Record<string, unknown>)[name] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn(`[llm-budget] ${name} is not a non-negative number — using ${fallback}`, { raw });
    return fallback;
  }
  return parsed;
}

/** Read on every access so tests and config reloads see changes. */
function config() {
  return {
    userDailyUsd: numberFromEnv('LLM_BUDGET_USER_DAILY_USD', 1.0),
    globalDailyUsd: numberFromEnv('LLM_BUDGET_GLOBAL_DAILY_USD', 50.0),
    /** Fraction of a budget at which a one-time warning fires. */
    alertThreshold: Math.min(numberFromEnv('LLM_BUDGET_ALERT_THRESHOLD', 0.8), 1),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── State ───────────────────────────────────────────────────────────────────

interface DayState {
  day: string;
  global: number;
  perUser: Map<string, number>;
  alerted: Set<string>;
  cutoffLogged: Set<string>;
}

function freshState(day: string): DayState {
  return { day, global: 0, perUser: new Map(), alerted: new Set(), cutoffLogged: new Set() };
}

export class LLMBudgetService {
  private state: DayState = freshState(today());

  /** Roll the counters when the UTC day changes. */
  private current(): DayState {
    const day = today();
    if (this.state.day !== day) this.state = freshState(day);
    return this.state;
  }

  private userSpend(userId: string | undefined): number {
    if (!userId) return 0;
    return this.current().perUser.get(userId) ?? 0;
  }

  /**
   * Decide whether another model call is affordable.
   *
   * Checked *before* the call, so the worst case is one call's overshoot rather
   * than an unbounded run.
   */
  canSpend(userId?: string): SpendDecision {
    const { userDailyUsd, globalDailyUsd } = config();
    const state = this.current();

    const globalRemaining = globalDailyUsd - state.global;
    if (globalRemaining <= 0) {
      this.logCutoffOnce('global', { limitUsd: globalDailyUsd, spendUsd: state.global });
      return { allowed: false, reason: 'global_budget_exhausted', remainingUsd: 0 };
    }

    if (userId) {
      const userRemaining = userDailyUsd - this.userSpend(userId);
      if (userRemaining <= 0) {
        this.logCutoffOnce(`user:${userId}`, {
          userId,
          limitUsd: userDailyUsd,
          spendUsd: this.userSpend(userId),
        });
        return { allowed: false, reason: 'user_budget_exhausted', remainingUsd: 0 };
      }
      return { allowed: true, remainingUsd: Math.min(userRemaining, globalRemaining) };
    }

    return { allowed: true, remainingUsd: globalRemaining };
  }

  /**
   * Record the cost of a completed call and fire the alert if a budget just
   * crossed its threshold.
   *
   * @returns the cost charged, in USD.
   */
  record(usage: TokenUsage, context: UsageContext): number {
    const { userDailyUsd, globalDailyUsd, alertThreshold } = config();
    const state = this.current();
    const costUsd = estimateCostUsd(context.model, usage);

    state.global += costUsd;
    if (context.userId) {
      state.perUser.set(context.userId, this.userSpend(context.userId) + costUsd);
    }

    this.maybeAlert('global', state.global, globalDailyUsd, alertThreshold, { scanId: context.scanId });
    if (context.userId) {
      this.maybeAlert(
        `user:${context.userId}`,
        this.userSpend(context.userId),
        userDailyUsd,
        alertThreshold,
        { userId: context.userId, scanId: context.scanId },
      );
    }

    void this.persist(usage, context, costUsd);
    return costUsd;
  }

  private maybeAlert(
    key: string,
    spendUsd: number,
    limitUsd: number,
    threshold: number,
    meta: Record<string, unknown>,
  ): void {
    if (limitUsd <= 0) return;
    const state = this.current();
    if (state.alerted.has(key)) return;
    if (spendUsd < limitUsd * threshold) return;

    state.alerted.add(key);
    logger.warn('[llm-budget] Spend crossed alert threshold', {
      budget: key,
      spendUsd: Number(spendUsd.toFixed(6)),
      limitUsd,
      thresholdPct: Math.round(threshold * 100),
      ...meta,
    });
  }

  private logCutoffOnce(key: string, meta: Record<string, unknown>): void {
    const state = this.current();
    if (state.cutoffLogged.has(key)) return;
    state.cutoffLogged.add(key);
    logger.error('[llm-budget] Hard cutoff reached — degrading to heuristic parsing', {
      budget: key,
      ...meta,
    });
  }

  /**
   * Durable per-call attribution. Best-effort: a ledger write failure must
   * never fail a parse, because the in-memory counters are what actually
   * enforce the budget.
   */
  private async persist(usage: TokenUsage, context: UsageContext, costUsd: number): Promise<void> {
    try {
      const { error } = await supabase.from('llm_usage_ledger').insert({
        user_id: context.userId ?? null,
        scan_id: context.scanId ?? null,
        model: context.model,
        prompt_version: context.promptVersion,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: Number(costUsd.toFixed(8)),
        cached: context.cached ?? false,
        created_at: new Date().toISOString(),
      });
      if (error) {
        logger.warn('[llm-budget] Failed to write usage ledger row', { error: error.message });
      }
    } catch (err) {
      logger.warn('[llm-budget] Failed to write usage ledger row', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  snapshot(userId?: string): BudgetSnapshot {
    const { userDailyUsd, globalDailyUsd, alertThreshold } = config();
    const state = this.current();
    return {
      day: state.day,
      globalSpendUsd: state.global,
      globalLimitUsd: globalDailyUsd,
      userSpendUsd: this.userSpend(userId),
      userLimitUsd: userDailyUsd,
      alertThreshold,
    };
  }

  /** Test hook — drops all counters for the current day. */
  reset(): void {
    this.state = freshState(today());
  }
}

export const llmBudgetService = new LLMBudgetService();
