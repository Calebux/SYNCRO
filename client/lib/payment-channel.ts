const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CHANNEL_STORAGE_KEY = 'syncro_payment_channels';

export interface PaymentChannel {
  id: string;
  counterparty: string;
  balance: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  lastUpdated: string;
  expiry?: string;
  challengePeriodEndsAt?: string;
  history?: ChannelHistoryItem[];
}

export interface ChannelHistoryItem {
  id: string;
  type: 'open' | 'topup' | 'payment' | 'close' | 'dispute';
  amount?: string;
  timestamp: string;
  description?: string;
}

export interface ChannelStreamSnapshot {
  type: 'snapshot' | 'error';
  channels?: PaymentChannel[];
  degradedMode?: boolean;
  message?: string;
  serverTime: string;
}

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
  title: string;
  timestamp: string;
  source: 'on-chain' | 'off-chain';
  amount?: number;
  nonce?: string;
  stateNumber?: number;
  balance?: number;
  confirmed?: boolean;
  sequenceNumber?: number;
  transactionHash?: string;
  explorerUrl?: string;
  note?: string;
}

export interface ChannelFinancials {
  deposited: number;
  userBalance: number;
  meteredBalance: number;
  unsettled: number;
  committedOnChain: {
    balanceA: number;
    balanceB: number;
    sequence: number;
    transactionHash: string;
    timestamp: string;
  } | null;
}

export interface ChannelChallengeStatus {
  windowSeconds: number;
  windowDays: number;
  periodActive: boolean;
  deadline: string | null;
  remainingSeconds: number | null;
  source: 'on-chain' | 'default';
}

export interface ChannelHistoryResponse {
  channel: PaymentChannel;
  events: ChannelStateEvent[];
  financials: ChannelFinancials;
  challenge: ChannelChallengeStatus;
}

function persistChannels(channels: PaymentChannel[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CHANNEL_STORAGE_KEY, JSON.stringify(channels));
}

function loadPersistedChannels(): PaymentChannel[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(CHANNEL_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as PaymentChannel[];
  } catch {
    return [];
  }
}

function upsertChannel(channel: PaymentChannel): void {
  const channels = loadPersistedChannels();
  const idx = channels.findIndex((c) => c.id === channel.id);
  if (idx >= 0) channels[idx] = channel;
  else channels.push(channel);
  persistChannels(channels);
}

export async function getChannels(): Promise<PaymentChannel[]> {
  try {
    const res = await fetch(`${API_BASE}/api/payment-channels`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to fetch channels');
    const channels = await res.json();
    persistChannels(channels);
    return channels;
  } catch {
    return loadPersistedChannels();
  }
}

export function openChannelStream(onMessage: (snapshot: ChannelStreamSnapshot) => void): EventSource {
  const streamUrl = `${API_BASE}/api/payment-channels/stream`;
  const source = new EventSource(streamUrl, { withCredentials: true });

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as ChannelStreamSnapshot;
      if (payload.channels) {
        persistChannels(payload.channels);
      }
      onMessage(payload);
    } catch {
      onMessage({
        type: 'error',
        message: 'Failed to parse stream payload',
        serverTime: new Date().toISOString(),
      });
    }
  };

  source.onerror = () => {
    onMessage({
      type: 'error',
      message: 'Live updates unavailable',
      serverTime: new Date().toISOString(),
    });
  };

  return source;
}

export async function openChannel(depositAmount: string, counterparty: string = 'SYNCRO Executor'): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositAmount, counterparty }),
  });
  if (!res.ok) throw new Error('Failed to open channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function topUpChannel(channelId: string, amount: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/topup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) throw new Error('Failed to top up channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function closeChannel(channelId: string, unilateral: boolean = false): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/close`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unilateral }),
  });
  if (!res.ok) throw new Error('Failed to close channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function getChannel(channelId: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export function getPersistedChannels(): PaymentChannel[] {
  return loadPersistedChannels();
}

export interface ChannelPreferences {
  autoTopUp: boolean;
  autoTopUpAmount: number | null;
}

export async function getChannelPreferences(): Promise<ChannelPreferences> {
  const res = await fetch(`${API_BASE}/api/payment-channels/preferences`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel preferences');
  return res.json();
}

export async function updateChannelPreferences(
  prefs: Partial<ChannelPreferences>,
): Promise<ChannelPreferences> {
  const res = await fetch(`${API_BASE}/api/payment-channels/preferences`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Failed to update channel preferences');
  return res.json();
}

export async function getChannelHistory(channelId: string): Promise<ChannelHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/history`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel history');
  return res.json();
}

export interface WatchtowerRecord {
  address: string;
  bounty: number;
  registeredAt: string;
}

export async function getWatchtowers(channelId: string): Promise<WatchtowerRecord[]> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch watchtowers');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}

export async function grantWatchtowerAuthority(
  channelId: string,
  watchtower: string,
  bounty = 0,
): Promise<WatchtowerRecord[]> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchtower, bounty }),
  });
  if (!res.ok) throw new Error('Failed to grant authority');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}

export async function revokeWatchtowerAuthority(
  channelId: string,
  watchtower: string,
): Promise<WatchtowerRecord[]> {
  const encoded = encodeURIComponent(watchtower);
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers/${encoded}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to revoke authority');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}

// ---------------------------------------------------------------------------
// SEP-24 fiat on-ramp
// ---------------------------------------------------------------------------

export interface Sep24Anchor {
  id: string;
  name: string;
  homeDomain: string;
  network: 'testnet' | 'mainnet';
  assetCode: string;
  assetIssuer?: string;
  minAmount: number;
  maxAmount: number;
  feePercent: number;
  description: string;
}

/**
 * Supported anchors for the fiat on-ramp. Testnet entries are the ones wired
 * into the principal console; mainnet entries are documented for reference and
 * are rejected by `startSep24Deposit` unless explicitly allowed.
 */
export const SEP24_ANCHORS: Sep24Anchor[] = [
  {
    id: 'testanchor',
    name: 'Stellar Test Anchor',
    homeDomain: 'testanchor.stellar.org',
    network: 'testnet',
    assetCode: 'USDC',
    minAmount: 10,
    maxAmount: 10000,
    feePercent: 0.5,
    description: 'Reference SEP-24 anchor maintained by SDF for testnet development.',
  },
  {
    id: 'sdf-testnet-usdc',
    name: 'SDF Testnet USDC Anchor',
    homeDomain: 'testanchor.stellar.org',
    network: 'testnet',
    assetCode: 'USDC',
    minAmount: 5,
    maxAmount: 5000,
    feePercent: 0.5,
    description: 'Testnet USDC deposits routed through the SDF reference anchor.',
  },
];

export const SEP24_DEFAULT_ANCHOR_ID = 'testanchor';
export const SEP24_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const SEP24_POLL_INTERVAL_MS = 5000;

export interface Sep24Toml {
  TRANSFER_SERVER_SEP0024?: string;
  TRANSFER_SERVER?: string;
  SIGNING_KEY?: string;
  NETWORK_PASSPHRASE?: string;
  DOCUMENTATION?: { ORG_NAME?: string; ORG_URL?: string };
}

export interface Sep24AssetInfo {
  enabled: boolean;
  min_amount?: number;
  max_amount?: number;
  fee_fixed?: number;
  fee_percent?: number;
}

export interface Sep24Info {
  deposit: Record<string, Sep24AssetInfo>;
  withdraw?: Record<string, Sep24AssetInfo>;
  fee?: { enabled: boolean };
  features?: { account_creation?: boolean; claimable_balances?: boolean };
}

export interface Sep24DepositResponse {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

export type Sep24TransactionStatus =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_trust'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

export interface Sep24Transaction {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: Sep24TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  started_at?: string;
  completed_at?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  to?: string;
  deposit_memo?: string;
  deposit_memo_type?: string;
}

export interface Sep24DepositResult {
  transaction: Sep24Transaction;
  creditedAmount: number;
  channel: PaymentChannel;
}

export class Sep24Error extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'Sep24Error';
    this.code = code;
  }
}

function getAnchor(anchorId: string): Sep24Anchor {
  const anchor = SEP24_ANCHORS.find((a) => a.id === anchorId);
  if (!anchor) {
    throw new Sep24Error('unknown_anchor', `Unknown anchor: ${anchorId}`);
  }
  return anchor;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Sep24Error('timeout', `Request to ${url} timed out`);
    }
    throw new Sep24Error('network_error', `Request to ${url} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and parse the anchor's stellar.toml (SEP-1). */
export async function discoverAnchor(anchorId: string): Promise<Sep24Toml> {
  const anchor = getAnchor(anchorId);
  const url = `https://${anchor.homeDomain}/.well-known/stellar.toml`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Sep24Error('toml_unavailable', `Unable to load stellar.toml for ${anchor.homeDomain}`);
  }
  const text = await res.text();
  return parseToml(text);
}

/**
 * Minimal TOML parser covering the subset used by SEP-1 stellar.toml files
 * (top-level key/value pairs and single-level tables).
 */
export function parseToml(text: string): Sep24Toml {
  const result: Record<string, unknown> = {};
  let current: Record<string, unknown> = result;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const path = tableMatch[1].split('.').map((p) => p.trim());
      let node = result;
      for (const key of path) {
        if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      current = node;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    current[key] = value;
  }
  return result as Sep24Toml;
}

function resolveTransferServer(toml: Sep24Toml): string {
  const server = toml.TRANSFER_SERVER_SEP0024 || toml.TRANSFER_SERVER;
  if (!server) {
    throw new Sep24Error('no_transfer_server', 'Anchor does not advertise a SEP-24 transfer server');
  }
  return server.replace(/\/$/, '');
}

/** Fetch SEP-24 /info for the anchor. */
export async function fetchSep24Info(anchorId: string): Promise<Sep24Info> {
  const toml = await discoverAnchor(anchorId);
  const server = resolveTransferServer(toml);
  const res = await fetchWithTimeout(`${server}/info`);
  if (!res.ok) {
    throw new Sep24Error('info_unavailable', 'Unable to load SEP-24 /info');
  }
  return (await res.json()) as Sep24Info;
}

export interface StartSep24DepositParams {
  anchorId: string;
  account: string;
  amount: number;
  assetCode?: string;
  /** Optional URL the anchor redirects to after the interactive flow. */
  callbackUrl?: string;
  /** Allow mainnet anchors (disabled by default for safety). */
  allowMainnet?: boolean;
}

/**
 * Initiate a SEP-24 interactive deposit and return the URL the principal must
 * open to complete the fiat transfer.
 */
export async function startSep24Deposit(params: StartSep24DepositParams): Promise<Sep24DepositResponse> {
  const anchor = getAnchor(params.anchorId);
  if (anchor.network === 'mainnet' && !params.allowMainnet) {
    throw new Sep24Error('mainnet_disabled', 'Mainnet anchors are disabled in this build');
  }
  if (!params.account) {
    throw new Sep24Error('missing_account', 'A Stellar account is required for SEP-24 deposits');
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Sep24Error('invalid_amount', 'Deposit amount must be a positive number');
  }
  if (params.amount < anchor.minAmount || params.amount > anchor.maxAmount) {
    throw new Sep24Error(
      'amount_out_of_range',
      `Amount must be between ${anchor.minAmount} and ${anchor.maxAmount} ${anchor.assetCode}`,
    );
  }

  const toml = await discoverAnchor(params.anchorId);
  const server = resolveTransferServer(toml);
  const assetCode = params.assetCode || anchor.assetCode;

  const body = new URLSearchParams({
    asset_code: assetCode,
    account: params.account,
    amount: String(params.amount),
  });
  if (params.callbackUrl) body.set('callback', params.callbackUrl);

  const res = await fetchWithTimeout(`${server}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Sep24Error('deposit_failed', `Anchor rejected deposit request (${res.status})`);
  }
  const payload = (await res.json()) as Sep24DepositResponse;
  if (!payload?.url || !payload?.id) {
    throw new Sep24Error('invalid_response', 'Anchor returned an invalid deposit response');
  }
  return payload;
}

/** Fetch the current state of a SEP-24 transaction. */
export async function fetchSep24Transaction(
  anchorId: string,
  transactionId: string,
): Promise<Sep24Transaction> {
  const toml = await discoverAnchor(anchorId);
  const server = resolveTransferServer(toml);
  const res = await fetchWithTimeout(
    `${server}/transaction?id=${encodeURIComponent(transactionId)}`,
  );
  if (!res.ok) {
    throw new Sep24Error('transaction_unavailable', `Unable to load transaction ${transactionId}`);
  }
  const payload = (await res.json()) as { transaction?: Sep24Transaction };
  if (!payload?.transaction) {
    throw new Sep24Error('invalid_response', 'Anchor returned an invalid transaction payload');
  }
  return payload.transaction;
}

export interface WaitForSep24DepositParams {
  anchorId: string;
  transactionId: string;
  channelId: string;
  /** Override the default 10 minute timeout. */
  timeoutMs?: number;
  /** Override the default 5 second poll interval. */
  pollIntervalMs?: number;
  onStatus?: (transaction: Sep24Transaction) => void;
}

const TERMINAL_FAILURE_STATUSES: Sep24TransactionStatus[] = ['error', 'refunded', 'expired'];

/**
 * Poll the anchor until the deposit completes, then credit the payment channel
 * via `topUpChannel`. Returns the final transaction and the updated channel.
 */
export async function waitForSep24DepositAndTopUp(
  params: WaitForSep24DepositParams,
): Promise<Sep24DepositResult> {
  const timeoutMs = params.timeoutMs ?? SEP24_DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = params.pollIntervalMs ?? SEP24_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const transaction = await fetchSep24Transaction(params.anchorId, params.transactionId);
    params.onStatus?.(transaction);

    if (transaction.status === 'completed') {
      const credited = Number(transaction.amount_out ?? transaction.amount_in ?? 0);
      if (!Number.isFinite(credited) || credited <= 0) {
        throw new Sep24Error('invalid_amount', 'Anchor reported a completed deposit with no amount');
      }
      const channel = await topUpChannel(params.channelId, credited.toFixed(7));
      return { transaction, creditedAmount: credited, channel };
    }

    if (TERMINAL_FAILURE_STATUSES.includes(transaction.status)) {
      throw new Sep24Error(
        `deposit_${transaction.status}`,
        transaction.message || `Deposit ${transaction.status}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Sep24Error('timeout', 'Timed out waiting for the anchor to confirm the deposit');
}

export interface Sep24DepositFlowParams extends StartSep24DepositParams {
  channelId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (transaction: Sep24Transaction) => void;
}

/**
 * End-to-end helper: start the interactive deposit, then wait for confirmation
 * and top up the channel. The caller is responsible for opening the returned
 * interactive URL in a browser window.
 */
export async function runSep24DepositFlow(
  params: Sep24DepositFlowParams,
): Promise<{ interactiveUrl: string; result: Promise<Sep24DepositResult> }> {
  const deposit = await startSep24Deposit(params);
  const result = waitForSep24DepositAndTopUp({
    anchorId: params.anchorId,
    transactionId: deposit.id,
    channelId: params.channelId,
    timeoutMs: params.timeoutMs,
    pollIntervalMs: params.pollIntervalMs,
    onStatus: params.onStatus,
  });
  return { interactiveUrl: deposit.url, result };
}
