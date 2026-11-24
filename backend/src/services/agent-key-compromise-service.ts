import { supabase } from '../config/database';
import logger from '../config/logger';

export interface AgentKeyCompromiseSignalsInput {
  spendVelocityPerMinute: number;
  baselineVelocityPerMinute: number;
  isNewNetworkOrigin: boolean;
  routeMixShiftPercent: number;
  dormantDays: number;
}

export interface AgentKeyCompromiseSignalResult {
  spendVelocityAnomaly: boolean;
  newNetworkOrigin: boolean;
  routeMixShift: boolean;
  dormantKeyReuse: boolean;
  score: number;
  severity: 'low' | 'medium' | 'high';
}

export interface AgentKeyContainmentResult {
  apiKeyRevoked: boolean;
  channelsSuspended: number;
  settlementsCancelled: number;
}

export class AgentKeyCompromiseService {
  evaluateSignals(input: AgentKeyCompromiseSignalsInput): AgentKeyCompromiseSignalResult {
    const velocityRatio =
      input.baselineVelocityPerMinute <= 0
        ? input.spendVelocityPerMinute
        : input.spendVelocityPerMinute / input.baselineVelocityPerMinute;

    const spendVelocityAnomaly = velocityRatio >= 3;
    const newNetworkOrigin = input.isNewNetworkOrigin;
    const routeMixShift = input.routeMixShiftPercent >= 35;
    const dormantKeyReuse = input.dormantDays >= 14;

    let score = 0;
    if (spendVelocityAnomaly) score += 30;
    if (newNetworkOrigin) score += 25;
    if (routeMixShift) score += 20;
    if (dormantKeyReuse) score += 25;

    const severity = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

    return {
      spendVelocityAnomaly,
      newNetworkOrigin,
      routeMixShift,
      dormantKeyReuse,
      score,
      severity,
    };
  }

  async containCompromisedKey(apiKeyId: string, reason: string): Promise<AgentKeyContainmentResult> {
    const { data: apiKey, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, user_id, revoked')
      .eq('id', apiKeyId)
      .maybeSingle();

    if (fetchError || !apiKey) {
      throw new Error('API key not found');
    }

    const userId = apiKey.user_id as string;

    const { error: revokeError } = await supabase
      .from('api_keys')
      .update({ revoked: true, updated_at: new Date().toISOString() })
      .eq('id', apiKeyId);
    if (revokeError) throw revokeError;

    const { data: channelRows, error: channelError } = await supabase
      .from('payment_channels')
      .update({ state: 'closing', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('state', 'active')
      .select('id');
    if (channelError) throw channelError;

    const { data: settlementRows, error: settlementError } = await supabase
      .from('pending_settlements')
      .update({
        status: 'cancelled',
        error_message: `Cancelled due to compromised agent key containment: ${reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('status', ['pending', 'batched'])
      .select('id');
    if (settlementError) throw settlementError;

    const channelsSuspended = channelRows?.length ?? 0;
    const settlementsCancelled = settlementRows?.length ?? 0;

    logger.warn('Compromised key containment executed', {
      apiKeyId,
      userId,
      channelsSuspended,
      settlementsCancelled,
      reason,
    });

    return {
      apiKeyRevoked: true,
      channelsSuspended,
      settlementsCancelled,
    };
  }
}

export const agentKeyCompromiseService = new AgentKeyCompromiseService();
