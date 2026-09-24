import logger from '../../config/logger';

export interface SpendCapRecord {
  cardId: number | string;
  agentId: string;
  onChainCap: number;
  consumedLocal: number;
  lastSettledOnChainCap: number;
  dailyLimit: number;
  monthlyLimit: number;
  status: 'active' | 'suspended' | 'closed';
  expiresAt: number; // unix timestamp in seconds
}

export interface SpendCapCheckResult {
  canTransact: boolean;
  remainingAllowance: number;
  requiredAmount: number;
  reason?: string;
}

export class SpendCapService {
  private capCache = new Map<string, SpendCapRecord>();

  setCap(record: SpendCapRecord): void {
    this.capCache.set(record.agentId, { ...record });
  }

  getCap(agentId: string): SpendCapRecord | null {
    return this.capCache.get(agentId) || null;
  }

  /**
   * Evaluates if agent has enough spend cap for the priced upper bound of a call.
   */
  canTransact(agentId: string, upperBoundAmount: number, nowSec: number = Math.floor(Date.now() / 1000)): SpendCapCheckResult {
    const record = this.capCache.get(agentId);
    if (!record) {
      return {
        canTransact: false,
        remainingAllowance: 0,
        requiredAmount: upperBoundAmount,
        reason: `No spend cap record found for agent ${agentId}`,
      };
    }

    if (record.status !== 'active') {
      return {
        canTransact: false,
        remainingAllowance: 0,
        requiredAmount: upperBoundAmount,
        reason: `Spend cap is not active (status: ${record.status})`,
      };
    }

    if (record.expiresAt > 0 && nowSec > record.expiresAt) {
      return {
        canTransact: false,
        remainingAllowance: 0,
        requiredAmount: upperBoundAmount,
        reason: `Spend cap expired at ${new Date(record.expiresAt * 1000).toISOString()}`,
      };
    }

    const remaining = Math.max(0, record.onChainCap - record.consumedLocal);
    if (upperBoundAmount > remaining) {
      return {
        canTransact: false,
        remainingAllowance: remaining,
        requiredAmount: upperBoundAmount,
        reason: `Spend cap exceeded: call requires ${upperBoundAmount}, but remaining allowance is only ${remaining}`,
      };
    }

    return {
      canTransact: true,
      remainingAllowance: remaining,
      requiredAmount: upperBoundAmount,
    };
  }

  /**
   * Track consumption locally between settlements.
   */
  consumeLocal(agentId: string, amount: number): boolean {
    const record = this.capCache.get(agentId);
    if (!record) return false;

    record.consumedLocal += amount;
    this.capCache.set(agentId, record);
    return true;
  }

  /**
   * Reconcile local view against the chain each settlement, correcting drift.
   */
  reconcileSettlement(agentId: string, newOnChainCap: number, settledAmount: number): SpendCapRecord | null {
    const record = this.capCache.get(agentId);
    if (!record) return null;

    logger.info(`[SpendCapService] Reconciling settlement for agent ${agentId}. Old onChain: ${record.onChainCap}, local consumed: ${record.consumedLocal}, settled: ${settledAmount}, new onChain: ${newOnChainCap}`);

    record.onChainCap = newOnChainCap;
    record.lastSettledOnChainCap = newOnChainCap;
    // Reset or adjust local consumption drift
    record.consumedLocal = Math.max(0, record.consumedLocal - settledAmount);
    this.capCache.set(agentId, record);
    return record;
  }

  clear(): void {
    this.capCache.clear();
  }
}

export const spendCapService = new SpendCapService();
