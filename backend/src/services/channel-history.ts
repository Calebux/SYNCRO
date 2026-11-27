/**
 * channel-history.ts
 *
 * Assembles the full, operator-grade history of a single payment channel so a
 * settlement dispute can be reconstructed without reading the chain by hand.
 *
 * Sources are merged into one timeline:
 *  1. `blockchain_logs`   — on-chain events indexed by the payment-channel
 *                           contract (opened / toppedup / submitted / closing /
 *                           disputed / closed), each carrying a transaction hash
 *                           that links out to a network explorer.
 *  2. `channel_states`    — off-chain signed state updates (nonce, state number,
 *                           balance, counterparty confirmation).
 *  3. `channel_payments`  — off-chain metered renewals paid through the channel.
 *
 * Two derived numbers are returned alongside the timeline:
 *  - `unsettled`     — metered value not yet present in a submitted on-chain
 *                      state (the operator's exposure).
 *  - `challenge`     — the dispute/challenge window and, while a close is in
 *                      flight, the time remaining until it can be finalised.
 */

import { supabase } from '../config/database';
import { paymentChannelService, type PaymentChannelRecord } from './payment-channel-service';
import { resolveExplorerUrl } from '../../../shared/blockchain-flags';

// ── Constants ────────────────────────────────────────────────────────────────

/** Matches the contract's default 7-day dispute window (open_channel arg). */
const DEFAULT_DISPUTE_WINDOW_SECS = 7 * 24 * 60 * 60;

const PAYMENT_CHANNEL_EVENT_PREFIX = 'channel.';

export type ChannelHistoryEventType =
  | 'open'
  | 'topup'
  | 'payment'
  | 'state_submitted'
  | 'close_initiated'
  | 'dispute'
  | 'finalize';

export interface ChannelStateEvent {
  id: string;
  type: ChannelHistoryEventType;
  /** Human readable label for operators. */
  title: string;
  timestamp: string;
  source: 'on-chain' | 'off-chain';
  amount?: number;
  /** Unique nonce of an off-chain state update. */
  nonce?: string;
  /** Monotonic state counter (off-chain) or sequence (on-chain). */
  stateNumber?: number;
  balance?: number;
  confirmed?: boolean;
  sequenceNumber?: number;
  transactionHash?: string;
  explorerUrl?: string;
  note?: string;
}

export interface ChannelFinancials {
  /** Total value ever deposited into the channel. */
  deposited: number;
  /** Current depositor-side balance. */
  userBalance: number;
  /** Metered value accumulated by the counterparty (off-chain). */
  meteredBalance: number;
  /**
   * Metered value not yet present in a submitted on-chain state — the
   * exposure a settlement dispute would leave on the table.
   */
  unsettled: number;
  /** Latest on-chain state commitment (balances + sequence + tx). */
  committedOnChain: {
    balanceA: number;
    balanceB: number;
    sequence: number;
    transactionHash: string;
    timestamp: string;
  } | null;
}

export interface ChannelChallengeStatus {
  /** Length of the challenge (dispute) window in seconds. */
  windowSeconds: number;
  windowDays: number;
  /** Whether a close is in flight and the challenge window is ticking. */
  periodActive: boolean;
  /** Deadline after which the channel can be finalised. */
  deadline: string | null;
  /** Whole seconds remaining in the challenge window (only while active). */
  remainingSeconds: number | null;
  /** Whether the window came from an on-chain `opened` event or the default. */
  source: 'on-chain' | 'default';
}

export interface ChannelHistoryResponse {
  channel: PaymentChannelRecord;
  events: ChannelStateEvent[];
  financials: ChannelFinancials;
  challenge: ChannelChallengeStatus;
}

// ── On-chain event decoding helpers ──────────────────────────────────────────

type Primitive = number | string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Best-effort extraction of primitive fields from a Soroban event `value`.
 * The payment-channel contract publishes tuples; different node JSON
 * serialisations are all flattened, preserving left-to-right order so callers
 * can pick fields positionally.
 */
function collectPrimitives(value: unknown, out: Primitive[]): void {
  if (value === null || value === undefined) return;

  if (typeof value === 'number') {
    out.push(value);
    return;
  }
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrimitives(item, out);
    return;
  }
  if (!isRecord(value)) return;

  // Numeric ScVal wrappers: { u64: { lo, hi } }, { i128: { lo, hi } }, { u32: 5 } …
  const numericKeys = ['u8', 'u32', 'u64', 'u128', 'u256', 'i32', 'i64', 'i128', 'i256'];
  for (const key of numericKeys) {
    if (key in value) {
      const inner = value[key];
      if (isRecord(inner)) {
        const lo = inner['lo'];
        if (typeof lo === 'number') out.push(lo);
        else if (typeof lo === 'string') out.push(Number(lo));
      } else if (typeof inner === 'number') {
        out.push(inner);
      }
      return;
    }
  }

  // { address: { contract: 'C…' } } or { address: { account: 'G…' } }
  if ('address' in value) {
    const addr = value['address'];
    if (isRecord(addr)) {
      const id = addr['contract'] ?? addr['account'];
      if (typeof id === 'string') out.push(id);
    } else if (typeof addr === 'string') {
      out.push(addr);
    }
    return;
  }

  // { symbol: 'foo' } / { bytes: 'ab…' }
  for (const key of ['symbol', 'bytes']) {
    if (typeof value[key] === 'string') {
      out.push(value[key] as string);
      return;
    }
  }

  // Nested vec / object / tuple containers — recurse in key order.
  for (const child of Object.values(value)) {
    collectPrimitives(child, out);
  }
}

interface DecodedChannelEventValue {
  channelId?: number;
  balanceA?: number;
  balanceB?: number;
  sequence?: number;
  amount?: number;
  depositAmount?: number;
  disputeWindowSeconds?: number;
}

function decodeChannelEventValue(value: unknown, action: string): DecodedChannelEventValue {
  const primitives: Primitive[] = [];
  collectPrimitives(value, primitives);
  // First numeric primitive is always the channel id (u64) for every
  // payment-channel event; subsequent numerics follow the contract's tuple.
  const numbers = primitives.filter((p): p is number => typeof p === 'number');
  const decoded: DecodedChannelEventValue = {};
  if (numbers.length > 0) decoded.channelId = numbers[0];

  switch (action) {
    case 'opened':
      // (id, depositor, counterparty, deposit_amount, dispute_window)
      if (numbers[1] !== undefined) decoded.depositAmount = numbers[1];
      if (numbers[2] !== undefined) decoded.disputeWindowSeconds = numbers[2];
      break;
    case 'submitted':
    case 'closing':
    case 'disputed':
      // (id, balance_a, balance_b, sequence)
      if (numbers[1] !== undefined) decoded.balanceA = numbers[1];
      if (numbers[2] !== undefined) decoded.balanceB = numbers[2];
      if (numbers[3] !== undefined) decoded.sequence = numbers[3];
      break;
    case 'closed':
      // (id, balance_a, balance_b)
      if (numbers[1] !== undefined) decoded.balanceA = numbers[1];
      if (numbers[2] !== undefined) decoded.balanceB = numbers[2];
      break;
    case 'toppedup':
      // (id, amount)
      if (numbers[1] !== undefined) decoded.amount = numbers[1];
      break;
    default:
      break;
  }
  return decoded;
}

function parseEventData(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeEventAction(eventType: string | null): string | null {
  if (!eventType || !eventType.startsWith(PAYMENT_CHANNEL_EVENT_PREFIX)) return null;
  return eventType.slice(PAYMENT_CHANNEL_EVENT_PREFIX.length);
}

const EVENT_TITLES: Record<ChannelHistoryEventType, string> = {
  open: 'Channel opened',
  topup: 'Channel topped up',
  payment: 'Payment metered off-chain',
  state_submitted: 'State submitted',
  close_initiated: 'Close initiated',
  dispute: 'Dispute filed',
  finalize: 'Channel finalised',
};

// ── Row shapes ───────────────────────────────────────────────────────────────

interface RawChannelRow {
  id?: string | null;
  channel_id?: string | null;
  opened_at?: string | null;
  deposit_amount?: number | string | null;
  updated_at?: string | null;
}

interface ChannelStateRow {
  id?: string | number | null;
  channel_id: string;
  state_number?: string | number | null;
  balance: number | string;
  nonce: string;
  signature?: string | null;
  counterparty_signature?: string | null;
  confirmed?: boolean | null;
  created_at?: string | null;
}

interface ChannelPaymentRow {
  id?: string | null;
  subscription_id?: string | null;
  amount?: number | string | null;
  sequence_number?: string | number | null;
  created_at?: string | null;
}

interface BlockchainLogRow {
  event_type?: string | null;
  event_data?: unknown;
  transaction_hash?: string | null;
  created_at?: string;
}

interface OnChainChannelEvent {
  action: string;
  decoded: DecodedChannelEventValue;
  txHash: string;
  timestamp: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ChannelHistoryService {
  /**
   * Returns the merged history for a channel owned by `userId`, or `null` when
   * the channel does not exist or is not owned by the caller.
   */
  async getHistory(userId: string, channelId: string): Promise<ChannelHistoryResponse | null> {
    const channel = await paymentChannelService.getChannel(userId, channelId);
    if (!channel) return null;

    const raw = await this.fetchRawChannel(channelId, userId);

    const [states, payments, onChainEvents] = await Promise.all([
      this.fetchStates(channelId, channel),
      this.fetchPayments(userId, channelId),
      this.fetchOnChainEvents(channel, raw),
    ]);

    const events = this.mergeEvents(channel, raw, states, payments, onChainEvents);
    const financials = this.computeFinancials(channel, onChainEvents);
    const challenge = this.computeChallenge(channel, onChainEvents);

    return { channel, events, financials, challenge };
  }

  // ── Data access ──────────────────────────────────────────────────────────

  private async fetchRawChannel(id: string, userId: string): Promise<RawChannelRow> {
    const { data } = await supabase
      .from('payment_channels')
      .select('channel_id, opened_at, deposit_amount, updated_at')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    return (data ?? {}) as RawChannelRow;
  }

  /**
   * Off-chain signed state updates. `channel_states.channel_id` may reference
   * either the local payment_channels primary key or the on-chain channel id
   * depending on which writer produced it, so both identifiers are matched.
   */
  private async fetchStates(channelId: string, channel: PaymentChannelRecord): Promise<ChannelStateRow[]> {
    const candidates = Array.from(
      new Set(
        [channelId, channel.onChainChannelId]
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );

    const { data, error } = await supabase
      .from('channel_states')
      .select('*')
      .in('channel_id', candidates)
      .order('created_at', { ascending: true });

    if (error) return [];
    return (data ?? []) as unknown as ChannelStateRow[];
  }

  private async fetchPayments(userId: string, channelId: string): Promise<ChannelPaymentRow[]> {
    const { data, error } = await supabase
      .from('channel_payments')
      .select('*')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) return [];
    return (data ?? []) as unknown as ChannelPaymentRow[];
  }

  /**
   * On-chain payment-channel events, filtered to this channel via its numeric
   * on-chain channel id when known.
   */
  private async fetchOnChainEvents(
    channel: PaymentChannelRecord,
    raw: RawChannelRow,
  ): Promise<OnChainChannelEvent[]> {
    const candidateIds = new Set(
      [channel.onChainChannelId, raw.channel_id]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => String(Number(v)))
        .filter((v) => v !== 'NaN'),
    );
    if (candidateIds.size === 0) return [];

    const { data, error } = await supabase
      .from('blockchain_logs')
      .select('*')
      .ilike('event_type', `${PAYMENT_CHANNEL_EVENT_PREFIX}%`)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error || !data) return [];

    const events: OnChainChannelEvent[] = [];
    for (const row of data as unknown as BlockchainLogRow[]) {
      const action = normalizeEventAction(row.event_type ?? null);
      if (!action) continue;

      const eventData = parseEventData(row.event_data);
      if (!eventData) continue;

      const txHash = row.transaction_hash ?? (eventData['txHash'] as string | undefined);
      if (!txHash) continue;

      const decoded = decodeChannelEventValue(eventData['value'], action);
      // Only attribute events whose channel id matches this channel.
      if (decoded.channelId === undefined) continue;
      if (!candidateIds.has(String(decoded.channelId))) continue;

      const timestamp =
        (eventData['ledgerClosedAt'] as string | undefined) ??
        row.created_at ??
        new Date().toISOString();

      events.push({ action, decoded, txHash, timestamp });
    }

    return events;
  }

  // ── Composition ──────────────────────────────────────────────────────────

  private mergeEvents(
    channel: PaymentChannelRecord,
    raw: RawChannelRow,
    states: ChannelStateRow[],
    payments: ChannelPaymentRow[],
    onChain: OnChainChannelEvent[],
  ): ChannelStateEvent[] {
    const events: ChannelStateEvent[] = [];

    // 1. Open (the channel record itself).
    events.push({
      id: `offchain-open:${channel.id}`,
      type: 'open',
      title: EVENT_TITLES.open,
      timestamp: raw.opened_at ?? channel.lastUpdated,
      source: 'off-chain',
      amount: Number(raw.deposit_amount ?? 0),
      note: `Counterparty: ${channel.counterparty}`,
    });

    // 2. On-chain events (top-ups, submitted states, close, disputes, finalize).
    for (const evt of onChain) {
      const mapped = this.mapOnChainEvent(evt);
      if (mapped) events.push(mapped);
    }

    // 3. Off-chain metered payments.
    for (const p of payments) {
      events.push({
        id: `payment:${p.id ?? `${p.sequence_number ?? 'seq'}-${p.created_at ?? 'ts'}`}`,
        type: 'payment',
        title: EVENT_TITLES.payment,
        timestamp: p.created_at ?? channel.lastUpdated,
        source: 'off-chain',
        amount: Number(p.amount ?? 0),
        sequenceNumber: p.sequence_number !== undefined && p.sequence_number !== null
          ? Number(p.sequence_number)
          : undefined,
        note: p.subscription_id ? `Subscription ${p.subscription_id}` : undefined,
      });
    }

    // 4. Off-chain signed states (nonce + state number + confirmation).
    for (const s of states) {
      events.push({
        id: `state:${s.id ?? `${s.state_number ?? 'n'}-${s.nonce}`}`,
        type: 'state_submitted',
        title: EVENT_TITLES.state_submitted,
        timestamp: s.created_at ?? channel.lastUpdated,
        source: 'off-chain',
        nonce: s.nonce,
        stateNumber: s.state_number !== undefined && s.state_number !== null
          ? Number(s.state_number)
          : undefined,
        balance: Number(s.balance ?? 0),
        confirmed: Boolean(s.confirmed),
        note: s.counterparty_signature ? 'Counterparty signed' : 'Awaiting counterparty signature',
      });
    }

    // 5. Local close lifecycle marker — only when no on-chain close exists.
    if (channel.state === 'closing' || channel.state === 'dispute' || channel.state === 'closed') {
      const hasOnChainClose = onChain.some((e) =>
        e.action === 'closing' || e.action === 'disputed' || e.action === 'closed',
      );
      if (!hasOnChainClose) {
        const closeType: ChannelHistoryEventType =
          channel.state === 'dispute'
            ? 'dispute'
            : channel.state === 'closed'
              ? 'finalize'
              : 'close_initiated';
        events.push({
          id: `offchain-close:${channel.id}`,
          type: closeType,
          title: EVENT_TITLES[closeType],
          timestamp: channel.lastUpdated,
          source: 'off-chain',
          note:
            channel.state === 'dispute'
              ? 'Unilateral close — dispute window open'
              : channel.state === 'closed'
                ? 'Channel settled and closed locally'
                : 'Close — challenge window open',
        });
      }
    }

    events.sort((a, b) => {
      const diff = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    return events;
  }

  private mapOnChainEvent(evt: OnChainChannelEvent): ChannelStateEvent | null {
    const base = {
      id: `onchain:${evt.txHash}:${evt.action}`,
      timestamp: evt.timestamp,
      source: 'on-chain' as const,
      transactionHash: evt.txHash,
      explorerUrl: resolveExplorerUrl(evt.txHash),
    };

    switch (evt.action) {
      case 'opened':
        return {
          ...base,
          type: 'open' as const,
          title: `${EVENT_TITLES.open} (on-chain)`,
          amount: evt.decoded.depositAmount,
          note:
            evt.decoded.disputeWindowSeconds !== undefined
              ? `Challenge window ${evt.decoded.disputeWindowSeconds}s`
              : undefined,
        };
      case 'toppedup':
        return {
          ...base,
          type: 'topup' as const,
          title: EVENT_TITLES.topup,
          amount: evt.decoded.amount,
        };
      case 'submitted':
        return {
          ...base,
          type: 'state_submitted' as const,
          title: `${EVENT_TITLES.state_submitted} (on-chain)`,
          stateNumber: evt.decoded.sequence,
          sequenceNumber: evt.decoded.sequence,
          balance: evt.decoded.balanceA,
          confirmed: true,
          note:
            evt.decoded.balanceB !== undefined
              ? `Counterparty balance ${evt.decoded.balanceB}`
              : undefined,
        };
      case 'closing':
        return {
          ...base,
          type: 'close_initiated' as const,
          title: `${EVENT_TITLES.close_initiated} (on-chain)`,
          stateNumber: evt.decoded.sequence,
          sequenceNumber: evt.decoded.sequence,
          balance: evt.decoded.balanceA,
          confirmed: true,
        };
      case 'disputed':
        return {
          ...base,
          type: 'dispute' as const,
          title: `${EVENT_TITLES.dispute} (on-chain)`,
          stateNumber: evt.decoded.sequence,
          sequenceNumber: evt.decoded.sequence,
          balance: evt.decoded.balanceA,
          confirmed: true,
        };
      case 'closed':
        return {
          ...base,
          type: 'finalize' as const,
          title: `${EVENT_TITLES.finalize} (on-chain)`,
          balance: evt.decoded.balanceA,
          confirmed: true,
        };
      default:
        return null;
    }
  }

  // ── Financials ───────────────────────────────────────────────────────────

  private computeFinancials(
    channel: PaymentChannelRecord,
    onChain: OnChainChannelEvent[],
  ): ChannelFinancials {
    const state = channel.channelState;
    const deposited = state?.totalDeposited ?? Number(channel.balance ?? 0);
    const userBalance = state?.userBalance ?? Number(channel.balance ?? 0);
    const meteredBalance = state?.executorBalance ?? 0;

    // Latest on-chain commitment: submitted / closing / disputed states all
    // commit balances; pick the highest sequence (ties → latest timestamp).
    let committed: ChannelFinancials['committedOnChain'] = null;
    for (const evt of onChain) {
      if (evt.action !== 'submitted' && evt.action !== 'closing' && evt.action !== 'disputed') continue;
      if (evt.decoded.balanceB === undefined) continue;
      const candidate = {
        balanceA: evt.decoded.balanceA ?? 0,
        balanceB: evt.decoded.balanceB,
        sequence: evt.decoded.sequence ?? 0,
        transactionHash: evt.txHash,
        timestamp: evt.timestamp,
      };
      if (
        !committed ||
        candidate.sequence > committed.sequence ||
        (candidate.sequence === committed.sequence &&
          Date.parse(candidate.timestamp) >= Date.parse(committed.timestamp))
      ) {
        committed = candidate;
      }
    }

    const committedBalanceB = committed?.balanceB ?? 0;
    // Metered value that has not yet been committed on-chain is the exposure.
    const unsettled = Math.max(0, meteredBalance - committedBalanceB);

    return {
      deposited,
      userBalance,
      meteredBalance,
      unsettled,
      committedOnChain: committed,
    };
  }

  // ── Challenge window ─────────────────────────────────────────────────────

  private computeChallenge(
    channel: PaymentChannelRecord,
    onChain: OnChainChannelEvent[],
  ): ChannelChallengeStatus {
    const opened = onChain.find((e) => e.action === 'opened');
    const windowSeconds =
      opened?.decoded.disputeWindowSeconds !== undefined && opened.decoded.disputeWindowSeconds > 0
        ? opened.decoded.disputeWindowSeconds
        : DEFAULT_DISPUTE_WINDOW_SECS;

    const periodActive = channel.state === 'closing' || channel.state === 'dispute';

    let deadlineMs: number | null = null;
    if (opened) {
      // Contract anchors dispute_deadline at open + dispute_window.
      const openedAt = Date.parse(opened.timestamp);
      if (!Number.isNaN(openedAt)) deadlineMs = openedAt + windowSeconds * 1000;
    } else if (periodActive) {
      // No on-chain anchor: the close started when the channel flipped out of
      // active (initiateClose bumps updated_at).
      const closingStarted = Date.parse(channel.lastUpdated);
      if (!Number.isNaN(closingStarted)) deadlineMs = closingStarted + windowSeconds * 1000;
    }

    const remainingSeconds =
      periodActive && deadlineMs !== null
        ? Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000))
        : null;

    return {
      windowSeconds,
      windowDays: Math.round((windowSeconds / (24 * 60 * 60)) * 100) / 100,
      periodActive,
      deadline: deadlineMs !== null ? new Date(deadlineMs).toISOString() : null,
      remainingSeconds,
      source: opened ? 'on-chain' : 'default',
    };
  }
}

export const channelHistoryService = new ChannelHistoryService();