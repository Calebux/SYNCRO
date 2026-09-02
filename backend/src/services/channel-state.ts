import { supabase } from '../config/database';
import logger from '../config/logger';
import {
  paymentChannelService,
  type PaymentChannelRecord,
  type WatchtowerRecord,
} from './payment-channel-service';

export type { WatchtowerRecord } from './payment-channel-service';

export type ExpiryAlertDays = 7 | 3 | 1;
export type SettlementSchedule = 'monthly' | 'quarterly';

export interface ChannelHealthCheck {
  channelId: string;
  userId: string;
  expiryDaysRemaining: number | null;
  renewalsRemaining: number | null;
  expired: boolean;
}

export interface ChannelPaymentLog {
  channelId: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  sequenceNumber: number;
}

export interface ChannelSettlementCandidate {
  channelId: string;
  userId: string;
  executorBalance: number;
}

export interface WatchtowerSubmitInput {
  channelId: string;
  userId: string;
  watchtower: string;
  balanceA: number;
  balanceB: number;
  sequenceNumber: number;
}

export class WatchtowerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_WATCHTOWER'
      | 'STALE_STATE'
      | 'INVALID_STATE'
      | 'BOUNTY_EXCEEDS_CAP'
      | 'WATCHTOWER_IS_PARTY',
  ) {
    super(message);
    this.name = 'WatchtowerError';
  }
}

/** Mirrors on-chain MAX_WATCHTOWER_BOUNTY. */
export const MAX_WATCHTOWER_BOUNTY = 10_000;

export class ChannelStateService {
  private readonly expiryThresholds: ExpiryAlertDays[] = [7, 3, 1];

  async getAverageRenewalAmount(userId: string): Promise<number> {
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('price')
      .eq('user_id', userId)
      .eq('status', 'active');

    const prices = (subs ?? []).map((s) => Number(s.price)).filter((p) => p > 0);
    if (prices.length === 0) return 10;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  assessChannel(channel: PaymentChannelRecord, avgRenewal: number): ChannelHealthCheck {
    const balance = channel.channelState?.userBalance ?? Number.parseFloat(channel.balance);
    const renewalsRemaining = avgRenewal > 0 ? balance / avgRenewal : null;

    let expiryDaysRemaining: number | null = null;
    let expired = false;
    if (channel.expiry) {
      const ms = new Date(channel.expiry).getTime() - Date.now();
      expiryDaysRemaining = Math.ceil(ms / (24 * 60 * 60 * 1000));
      expired = expiryDaysRemaining <= 0;
    }

    return {
      channelId: channel.id,
      userId: channel.userId,
      expiryDaysRemaining,
      renewalsRemaining,
      expired,
    };
  }

  getExpiryAlertThreshold(daysRemaining: number | null): ExpiryAlertDays | null {
    if (daysRemaining === null || daysRemaining < 0) return null;
    let match: ExpiryAlertDays | null = null;
    for (const threshold of this.expiryThresholds) {
      if (daysRemaining <= threshold) match = threshold;
    }
    return match;
  }

  isLowBalance(renewalsRemaining: number | null): boolean {
    return renewalsRemaining !== null && renewalsRemaining < 2;
  }

  async listActiveChannels(): Promise<PaymentChannelRecord[]> {
    const { data, error } = await supabase
      .from('payment_channels')
      .select('*')
      .eq('state', 'active');

    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      counterparty: row.counterparty as string,
      balance: String(row.balance ?? 0),
      state: row.state as PaymentChannelRecord['state'],
      lastUpdated: (row.updated_at ?? row.created_at) as string,
      expiry: row.expiry as string | undefined,
      channelState: row.channel_state as PaymentChannelRecord['channelState'],
    }));
  }

  async getChannelPreferences(userId: string): Promise<{
    autoTopUp: boolean;
    autoTopUpAmount: number | null;
  }> {
    const { data } = await supabase
      .from('profiles')
      .select('channel_auto_top_up, channel_auto_top_up_amount')
      .eq('id', userId)
      .maybeSingle();

    return {
      autoTopUp: Boolean(data?.channel_auto_top_up),
      autoTopUpAmount: data?.channel_auto_top_up_amount
        ? Number(data.channel_auto_top_up_amount)
        : null,
    };
  }

  async setChannelPreferences(
    userId: string,
    prefs: { autoTopUp?: boolean; autoTopUpAmount?: number | null },
  ): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({
        ...(prefs.autoTopUp !== undefined && { channel_auto_top_up: prefs.autoTopUp }),
        ...(prefs.autoTopUpAmount !== undefined && {
          channel_auto_top_up_amount: prefs.autoTopUpAmount,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) throw error;
  }

  async closeExpiredChannel(userId: string, channelId: string): Promise<void> {
    await paymentChannelService.initiateClose(userId, channelId);
    await paymentChannelService.finalizeClose(userId, channelId);
    logger.info('Expired channel closed', { userId, channelId });
  }

  /**
   * Returns the newest active channel with sufficient off-chain balance.
   */
  async findPayableChannel(
    userId: string,
    amount: number,
  ): Promise<PaymentChannelRecord | null> {
    const channels = await paymentChannelService.listChannels(userId);
    for (const channel of channels) {
      if (channel.state !== 'active') continue;
      const balance =
        channel.channelState?.userBalance ?? Number.parseFloat(channel.balance);
      if (balance >= amount) return channel;
    }
    return null;
  }

  /**
   * Applies an off-chain state update and records the payment locally (not on-chain).
   */
  async applyRenewalPayment(
    channelId: string,
    userId: string,
    subscriptionId: string,
    amount: number,
  ): Promise<PaymentChannelRecord> {
    const updated = await paymentChannelService.applyOffChainRenewal(
      channelId,
      userId,
      amount,
    );

    await this.logChannelPayment({
      channelId,
      userId,
      subscriptionId,
      amount,
      sequenceNumber: updated.channelState?.sequenceNumber ?? 0,
    });

    return updated;
  }

  async logChannelPayment(payment: ChannelPaymentLog): Promise<void> {
    const { error } = await supabase.from('channel_payments').insert({
      channel_id: payment.channelId,
      user_id: payment.userId,
      subscription_id: payment.subscriptionId,
      amount: payment.amount,
      sequence_number: payment.sequenceNumber,
      created_at: new Date().toISOString(),
    });

    if (error) {
      logger.warn('Failed to log channel payment', {
        channelId: payment.channelId,
        error: error.message,
      });
    }
  }

  async getSettlementSchedule(userId: string): Promise<SettlementSchedule> {
    const { data } = await supabase
      .from('profiles')
      .select('channel_settlement_schedule')
      .eq('id', userId)
      .maybeSingle();

    return data?.channel_settlement_schedule === 'quarterly' ? 'quarterly' : 'monthly';
  }

  /**
   * Active channels whose executor-side balance should be settled on-chain.
   */
  async getChannelsDueForSettlement(): Promise<ChannelSettlementCandidate[]> {
    const { data: channels, error } = await supabase
      .from('payment_channels')
      .select('id, user_id, channel_state, last_settlement_at, state')
      .eq('state', 'active');

    if (error) throw error;

    const due: ChannelSettlementCandidate[] = [];
    const now = Date.now();

    for (const row of channels ?? []) {
      const state = row.channel_state as { executorBalance?: number } | null;
      const executorBalance = state?.executorBalance ?? 0;
      if (executorBalance <= 0) continue;

      const schedule = await this.getSettlementSchedule(row.user_id as string);
      const intervalMs =
        schedule === 'quarterly'
          ? 90 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;

      const lastSettlement = row.last_settlement_at
        ? new Date(row.last_settlement_at as string).getTime()
        : 0;

      if (now - lastSettlement >= intervalMs) {
        due.push({
          channelId: row.id as string,
          userId: row.user_id as string,
          executorBalance,
        });
      }
    }

    return due;
  }

  async markChannelSettled(channelId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('payment_channels')
      .update({
        last_settlement_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  private watchtowersOf(channel: PaymentChannelRecord): WatchtowerRecord[] {
    return channel.channelState?.watchtowers ?? [];
  }

  async listWatchtowers(userId: string, channelId: string): Promise<WatchtowerRecord[]> {
    const channel = await paymentChannelService.getChannel(userId, channelId);
    if (!channel) throw new Error('Channel not found');
    return this.watchtowersOf(channel);
  }

  async registerWatchtower(
    userId: string,
    channelId: string,
    watchtower: string,
    bounty = 0,
  ): Promise<WatchtowerRecord[]> {
    const channel = await paymentChannelService.getChannel(userId, channelId);
    if (!channel) throw new Error('Channel not found');
    if (channel.state !== 'active') {
      throw new WatchtowerError('Watchtowers can only be registered on an open channel', 'INVALID_STATE');
    }
    if (watchtower === channel.userId || watchtower === channel.counterparty) {
      throw new WatchtowerError('Watchtower cannot be a channel party', 'WATCHTOWER_IS_PARTY');
    }
    if (bounty < 0) {
      throw new WatchtowerError('Bounty must be non-negative', 'BOUNTY_EXCEEDS_CAP');
    }
    if (bounty > MAX_WATCHTOWER_BOUNTY) {
      throw new WatchtowerError(
        `Bounty exceeds cap of ${MAX_WATCHTOWER_BOUNTY}`,
        'BOUNTY_EXCEEDS_CAP',
      );
    }

    const existing = this.watchtowersOf(channel);
    if (existing.some((w) => w.address === watchtower)) {
      return existing;
    }

    const next: WatchtowerRecord[] = [
      ...existing,
      { address: watchtower, bounty, registeredAt: new Date().toISOString() },
    ];
    await this.persistWatchtowers(userId, channelId, channel, next);
    logger.info('Watchtower registered', { userId, channelId, watchtower, bounty });
    return next;
  }

  async deregisterWatchtower(
    userId: string,
    channelId: string,
    watchtower: string,
  ): Promise<WatchtowerRecord[]> {
    const channel = await paymentChannelService.getChannel(userId, channelId);
    if (!channel) throw new Error('Channel not found');
    if (channel.state !== 'active') {
      throw new WatchtowerError('Watchtowers can only be deregistered on an open channel', 'INVALID_STATE');
    }

    const existing = this.watchtowersOf(channel);
    if (!existing.some((w) => w.address === watchtower)) {
      throw new WatchtowerError('Address is not a registered watchtower', 'NOT_WATCHTOWER');
    }

    const next = existing.filter((w) => w.address !== watchtower);
    await this.persistWatchtowers(userId, channelId, channel, next);
    logger.info('Watchtower deregistered', { userId, channelId, watchtower });
    return next;
  }

  /**
   * A registered watchtower submits a newer signed state during the dispute window.
   * Principal balances still settle to the channel parties; the watchtower only
   * records the capped bounty.
   */
  async submitWatchtowerState(input: WatchtowerSubmitInput): Promise<PaymentChannelRecord> {
    const channel = await paymentChannelService.getChannel(input.userId, input.channelId);
    if (!channel) throw new Error('Channel not found');
    if (channel.state !== 'closing' && channel.state !== 'dispute') {
      throw new WatchtowerError('Watchtower submit is only valid during the dispute window', 'INVALID_STATE');
    }

    const towers = this.watchtowersOf(channel);
    const tower = towers.find((w) => w.address === input.watchtower);
    if (!tower) {
      throw new WatchtowerError('Caller is not a registered watchtower', 'NOT_WATCHTOWER');
    }

    const currentSeq = channel.channelState?.sequenceNumber ?? 0;
    if (input.sequenceNumber <= currentSeq) {
      throw new WatchtowerError('Submitted state is stale', 'STALE_STATE');
    }

    const nextState = {
      sequenceNumber: input.sequenceNumber,
      userBalance: input.balanceA,
      executorBalance: input.balanceB,
      totalDeposited: channel.channelState?.totalDeposited ?? input.balanceA + input.balanceB,
      watchtowers: towers,
      watchtowerBountyPaid: tower.bounty,
    };

    const { data, error } = await supabase
      .from('payment_channels')
      .update({
        state: 'dispute',
        balance: input.balanceA,
        channel_state: nextState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.channelId)
      .eq('user_id', input.userId)
      .select()
      .single();

    if (error) throw error;
    logger.info('Watchtower submitted newer channel state', {
      channelId: input.channelId,
      watchtower: input.watchtower,
      sequenceNumber: input.sequenceNumber,
      bounty: tower.bounty,
    });
    return {
      id: data.id as string,
      userId: data.user_id as string,
      counterparty: data.counterparty as string,
      balance: String(data.balance ?? 0),
      state: data.state as PaymentChannelRecord['state'],
      lastUpdated: (data.updated_at ?? data.created_at) as string,
      expiry: data.expiry as string | undefined,
      channelState: data.channel_state as PaymentChannelRecord['channelState'],
      onChainChannelId: data.on_chain_channel_id as string | undefined,
    };
  }

  /**
   * Channels in closing/dispute that have a registered watchtower and a locally
   * known newer sequence — candidates for watchtower submission.
   */
  async getChannelsNeedingWatchtower(): Promise<
    Array<{ channel: PaymentChannelRecord; watchtowers: WatchtowerRecord[] }>
  > {
    const { data, error } = await supabase
      .from('payment_channels')
      .select('*')
      .in('state', ['closing', 'dispute']);

    if (error) throw error;

    return (data ?? [])
      .map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        counterparty: row.counterparty as string,
        balance: String(row.balance ?? 0),
        state: row.state as PaymentChannelRecord['state'],
        lastUpdated: (row.updated_at ?? row.created_at) as string,
        expiry: row.expiry as string | undefined,
        channelState: row.channel_state as PaymentChannelRecord['channelState'],
        onChainChannelId: row.on_chain_channel_id as string | undefined,
      }))
      .map((channel) => ({ channel, watchtowers: this.watchtowersOf(channel) }))
      .filter(({ watchtowers }) => watchtowers.length > 0);
  }

  private async persistWatchtowers(
    userId: string,
    channelId: string,
    channel: PaymentChannelRecord,
    watchtowers: WatchtowerRecord[],
  ): Promise<void> {
    const { error } = await supabase
      .from('payment_channels')
      .update({
        channel_state: {
          ...(channel.channelState ?? {
            sequenceNumber: 0,
            userBalance: Number.parseFloat(channel.balance),
            executorBalance: 0,
            totalDeposited: Number.parseFloat(channel.balance),
          }),
          watchtowers,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId);

    if (error) throw error;
  }
}

export const channelStateService = new ChannelStateService();
