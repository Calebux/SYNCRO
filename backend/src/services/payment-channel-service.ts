import { supabase } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';

export interface ChannelState {
  sequenceNumber: number;
  userBalance: number;
  executorBalance: number;
  totalDeposited: number;
}

export interface PaymentChannelRecord {
  id: string;
  userId: string;
  counterparty: string;
  balance: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  lastUpdated: string;
  expiry?: string;
  channelState?: ChannelState;
  onChainChannelId?: string;
}

const STORAGE_KEY_PREFIX = 'syncro:channel:';

function signState(state: ChannelState, channelId: string): string {
  const payload = JSON.stringify({ channelId, ...state });
  return crypto.createHmac('sha256', process.env.CHANNEL_SIGNING_SECRET ?? 'dev-channel-secret')
    .update(payload)
    .digest('hex');
}

export class PaymentChannelService {
  async listChannels(userId: string): Promise<PaymentChannelRecord[]> {
    const { data, error } = await supabase
      .from('payment_channels')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(this.toRecord);
  }

  async getChannel(userId: string, channelId: string): Promise<PaymentChannelRecord | null> {
    const { data, error } = await supabase
      .from('payment_channels')
      .select('*')
      .eq('id', channelId)
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return this.toRecord(data);
  }

  async openChannel(
    userId: string,
    depositAmount: number,
    counterparty: string = 'SYNCRO Executor',
    disputeWindowDays = 7,
  ): Promise<PaymentChannelRecord> {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + disputeWindowDays * 30);

    const channelState: ChannelState = {
      sequenceNumber: 0,
      userBalance: depositAmount,
      executorBalance: 0,
      totalDeposited: depositAmount,
    };

    const { data, error } = await supabase
      .from('payment_channels')
      .insert({
        user_id: userId,
        counterparty,
        deposit_amount: depositAmount,
        balance: depositAmount,
        state: 'active',
        channel_state: channelState,
        state_signature: signState(channelState, 'pending'),
        expiry: expiry.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    logger.info('Payment channel opened', { userId, channelId: data.id, depositAmount });
    return this.toRecord(data);
  }

  async applyOffChainRenewal(
    channelId: string,
    userId: string,
    amount: number,
  ): Promise<PaymentChannelRecord> {
    const channel = await this.getChannel(userId, channelId);
    if (!channel || channel.state !== 'active') {
      throw new Error('Channel not found or not active');
    }

    const state = channel.channelState!;
    if (state.userBalance < amount) {
      throw new Error('Insufficient channel balance');
    }

    const nextState: ChannelState = {
      sequenceNumber: state.sequenceNumber + 1,
      userBalance: state.userBalance - amount,
      executorBalance: state.executorBalance + amount,
      totalDeposited: state.totalDeposited,
    };

    const { data, error } = await supabase
      .from('payment_channels')
      .update({
        balance: nextState.userBalance,
        channel_state: nextState,
        state_signature: signState(nextState, channelId),
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return this.toRecord(data);
  }

  async topUp(userId: string, channelId: string, amount: number): Promise<PaymentChannelRecord> {
    const channel = await this.getChannel(userId, channelId);
    if (!channel || channel.state !== 'active') {
      throw new Error('Channel not found or not active');
    }

    const state = channel.channelState!;
    const nextState: ChannelState = {
      sequenceNumber: state.sequenceNumber + 1,
      userBalance: state.userBalance + amount,
      executorBalance: state.executorBalance,
      totalDeposited: state.totalDeposited + amount,
    };

    const { data, error } = await supabase
      .from('payment_channels')
      .update({
        balance: nextState.userBalance,
        channel_state: nextState,
        state_signature: signState(nextState, channelId),
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return this.toRecord(data);
  }

  async initiateClose(
    userId: string,
    channelId: string,
    unilateral = false,
  ): Promise<PaymentChannelRecord> {
    const channel = await this.getChannel(userId, channelId);
    if (!channel || channel.state !== 'active') {
      throw new Error('Channel not found or not active');
    }

    const { data, error } = await supabase
      .from('payment_channels')
      .update({
        state: unilateral ? 'dispute' : 'closing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return this.toRecord(data);
  }

  async finalizeClose(userId: string, channelId: string): Promise<PaymentChannelRecord> {
    const { data, error } = await supabase
      .from('payment_channels')
      .update({
        state: 'closed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return this.toRecord(data);
  }

  getLocalStorageKey(channelId: string): string {
    return `${STORAGE_KEY_PREFIX}${channelId}`;
  }

  private toRecord(row: Record<string, unknown>): PaymentChannelRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      counterparty: row.counterparty as string,
      balance: String(row.balance ?? 0),
      state: row.state as PaymentChannelRecord['state'],
      lastUpdated: (row.updated_at ?? row.created_at) as string,
      expiry: row.expiry as string | undefined,
      channelState: row.channel_state as ChannelState | undefined,
      onChainChannelId: row.on_chain_channel_id as string | undefined,
    };
  }
}

export const paymentChannelService = new PaymentChannelService();
