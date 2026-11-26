/**
 * AUTO-GENERATED — do not edit manually.
 * Source: shared/src/generated/soroban-abi.json
 * Run: npm run generate:contracts -w sdk
 */

export interface SubscriptionRegistryContract {
  create_subscription(args: { user: string; service_id: string; billing_interval: bigint; expected_amount: bigint; next_renewal: bigint }): Promise<unknown>;
  update_subscription(args: { subscription_id: Uint8Array; user: string; service_id: unknown | null; billing_interval: unknown | null; expected_amount: unknown | null; next_renewal: unknown | null }): Promise<unknown>;
  cancel_subscription(args: { subscription_id: Uint8Array; caller: string }): Promise<unknown>;
}

export interface SubscriptionLoggingContract {
  record_log(args: { sub_id: bigint; event: string; data: string }): Promise<unknown>;
}

export interface SubscriptionRenewalContract {
  renew(args: { owner: string; sub_id: bigint; approval_id: bigint; amount: bigint; max_retries: bigint; cooldown_ledgers: bigint; cycle_id: bigint; succeed: boolean }): Promise<unknown>;
}

export interface PaymentChannelState {
  channel_id: Uint8Array;
  nonce: bigint;
  balance: bigint;
}

export interface PaymentChannelSignature {
  signer: string;
  signature: Uint8Array;
}

export interface PaymentChannelCheckpointResult {
  channel_id: Uint8Array;
  paid_out: bigint;
  checkpointed_amount: bigint;
  nonce: bigint;
}

export interface PaymentChannelBatchResult {
  channel_id: Uint8Array;
  success: boolean;
  error: string | null;
}

export interface PaymentChannelContract {
  open_channel(args: { payer: string; payee: string; token: string; deposit: bigint; challenge_duration: bigint }): Promise<unknown>;
  submit_state(args: { channel_id: Uint8Array; state: PaymentChannelState; sigs: PaymentChannelSignature[] }): Promise<unknown>;
  submit_state_with_agent(args: { channel_id: Uint8Array; state: PaymentChannelState; sigs: PaymentChannelSignature[]; agent_key: string; scope: string; expiry: bigint }): Promise<unknown>;
  submit_state_batch(args: { states: PaymentChannelState[]; sigs: PaymentChannelSignature[][] }): Promise<PaymentChannelBatchResult[]>;
  checkpoint(args: { channel_id: Uint8Array; state: PaymentChannelState; sigs: PaymentChannelSignature[] }): Promise<PaymentChannelCheckpointResult>;
  close_channel(args: { channel_id: Uint8Array; state: PaymentChannelState; sigs: PaymentChannelSignature[] }): Promise<unknown>;
  dispute_channel(args: { channel_id: Uint8Array; state: PaymentChannelState; sigs: PaymentChannelSignature[] }): Promise<unknown>;
}

export interface GeneratedContractMap {
  "SubscriptionRegistry": SubscriptionRegistryContract;
  "SubscriptionLogging": SubscriptionLoggingContract;
  "SubscriptionRenewal": SubscriptionRenewalContract;
  "PaymentChannel": PaymentChannelContract;
}