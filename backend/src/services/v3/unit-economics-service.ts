import logger from '../../config/logger';

export interface ChannelCostRecord {
  channelId: string;
  providerId: string;
  channelSize: number; // in units (e.g. USDC or stroops)
  chainFeePerSettlement: number;
  infrastructureCostPerCall: number;
  providerPayoutRate: number; // cost per call paid to upstream provider
  settledCallsCount: number;
  totalRevenue: number;
}

export interface UnitEconomicsSummary {
  channelId: string;
  providerId: string;
  channelSize: number;
  settledCallsCount: number;
  totalCostPerCall: number;
  amortizedChainFeePerCall: number;
  infrastructureCostPerCall: number;
  providerPayoutPerCall: number;
  revenuePerCall: number;
  netMarginPerCall: number;
  isNegativeEconomics: boolean;
}

export interface BatchingPolicyRecommendation {
  providerId: string;
  measuredAvgChainFee: number;
  minimumViableChannelSize: number;
  optimalBatchThreshold: number;
  targetCostPerCall: number;
  currentMarginPercent: number;
}

export class UnitEconomicsService {
  private channels = new Map<string, ChannelCostRecord>();
  private alerts: Array<{ channelId: string; providerId: string; reason: string; timestamp: string }> = [];

  recordChannel(record: ChannelCostRecord): void {
    this.channels.set(record.channelId, { ...record });
    this.evaluateChannelEconomics(record.channelId);
  }

  recordSettledBatch(channelId: string, settledCallsInBatch: number, batchChainFee: number, revenueEarned: number): UnitEconomicsSummary | null {
    const record = this.channels.get(channelId);
    if (!record) return null;

    record.settledCallsCount += settledCallsInBatch;
    record.chainFeePerSettlement = batchChainFee;
    record.totalRevenue += revenueEarned;

    this.channels.set(channelId, record);
    return this.evaluateChannelEconomics(channelId);
  }

  evaluateChannelEconomics(channelId: string): UnitEconomicsSummary | null {
    const record = this.channels.get(channelId);
    if (!record) return null;

    const calls = Math.max(1, record.settledCallsCount);
    const amortizedChainFee = record.chainFeePerSettlement / calls;
    const infraCost = record.infrastructureCostPerCall;
    const providerPayout = record.providerPayoutRate;
    const totalCostPerCall = amortizedChainFee + infraCost + providerPayout;

    const revenuePerCall = record.totalRevenue > 0 ? record.totalRevenue / calls : 0;
    const netMarginPerCall = revenuePerCall - totalCostPerCall;
    const isNegativeEconomics = revenuePerCall > 0 && netMarginPerCall < 0;

    if (isNegativeEconomics) {
      const alert = {
        channelId,
        providerId: record.providerId,
        reason: `Negative unit economics detected: Revenue/call (${revenuePerCall.toFixed(4)}) < Total Cost/call (${totalCostPerCall.toFixed(4)})`,
        timestamp: new Date().toISOString(),
      };
      this.alerts.push(alert);
      logger.warn(`[UnitEconomicsAlert] ${alert.reason}`, alert);
    }

    return {
      channelId,
      providerId: record.providerId,
      channelSize: record.channelSize,
      settledCallsCount: record.settledCallsCount,
      totalCostPerCall,
      amortizedChainFeePerCall: amortizedChainFee,
      infrastructureCostPerCall: infraCost,
      providerPayoutPerCall: providerPayout,
      revenuePerCall,
      netMarginPerCall,
      isNegativeEconomics,
    };
  }

  deriveBatchingPolicy(providerId: string, targetPricePerCall: number): BatchingPolicyRecommendation {
    const providerChannels = Array.from(this.channels.values()).filter((c) => c.providerId === providerId);

    const avgChainFee = providerChannels.length > 0
      ? providerChannels.reduce((sum, c) => sum + c.chainFeePerSettlement, 0) / providerChannels.length
      : 100; // default 100 stroops/units

    const avgInfra = providerChannels.length > 0
      ? providerChannels.reduce((sum, c) => sum + c.infrastructureCostPerCall, 0) / providerChannels.length
      : 1;

    const avgPayout = providerChannels.length > 0
      ? providerChannels.reduce((sum, c) => sum + c.providerPayoutRate, 0) / providerChannels.length
      : 5;

    // Minimum batch threshold to keep chain fee amortized <= 20% of target price
    const maxAllowableChainFeePerCall = Math.max(1, targetPricePerCall * 0.2);
    const optimalBatchThreshold = Math.ceil(avgChainFee / maxAllowableChainFeePerCall);

    // Minimum viable channel size to ensure at least 2 full batches before close
    const minViableChannelSize = Math.max(100, optimalBatchThreshold * (targetPricePerCall || 10) * 2);

    const currentMarginPercent = targetPricePerCall > 0
      ? ((targetPricePerCall - (avgChainFee / optimalBatchThreshold + avgInfra + avgPayout)) / targetPricePerCall) * 100
      : 0;

    return {
      providerId,
      measuredAvgChainFee: avgChainFee,
      minimumViableChannelSize: minViableChannelSize,
      optimalBatchThreshold: optimalBatchThreshold,
      targetCostPerCall: targetPricePerCall,
      currentMarginPercent,
    };
  }

  getAlerts() {
    return [...this.alerts];
  }

  clear(): void {
    this.channels.clear();
    this.alerts = [];
  }
}

export const unitEconomicsService = new UnitEconomicsService();
