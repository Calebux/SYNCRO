/**
 * Canonical Domain Glossary & Layer Mapping Types
 * Single source of truth across Contracts, Database, Backend API, Client UI, and SDK.
 * Refer to docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md for architectural specifications.
 */

export const DOMAIN_TERMS = [
  'subscription',
  'renewal',
  'payment',
  'charge',
  'settlement',
  'escrow',
  'channel',
  'card',
  'gift_card',
  'stealth_payment',
] as const;

export type DomainTerm = (typeof DOMAIN_TERMS)[number];

export interface LayerRepresentation {
  contract: string;
  database: string;
  backendApi: string;
  clientUi: string;
  sdk: string;
  notes?: string;
}

/**
 * Cross-layer mapping registry for reconciliation audits
 */
export const DOMAIN_LAYER_MAPPING: Record<DomainTerm, LayerRepresentation> = {
  subscription: {
    contract: 'SubscriptionRegistry / SubscriptionNFT (BytesN32 ID)',
    database: 'public.subscriptions (UUID id)',
    backendApi: 'Subscription DTO',
    clientUi: 'Subscription State & Card Component',
    sdk: 'Subscription Interface',
    notes: 'blockchain_sub_id column links database UUID to Soroban BytesN32 ID',
  },
  renewal: {
    contract: 'subscription_renewal::renew method',
    database: 'public.renewal_approvals & public.renewal_logs',
    backendApi: 'RenewalApproval & RenewalLog DTOs',
    clientUi: 'PendingApprovalModal & RenewalItem',
    sdk: 'RenewalApproval Interface',
    notes: 'Database tracks workflow/approvals; Smart contract executes token transfer',
  },
  payment: {
    contract: 'payment-adapter / Stellar transaction hash',
    database: 'public.payments, public.channel_payments, public.stealth_payments',
    backendApi: 'Payment DTO',
    clientUi: 'PaymentHistoryRow & TransactionStatus',
    sdk: 'Payment Interface',
    notes: 'Record of value transfer across fiat, Stellar native, or state channels',
  },
  charge: {
    contract: 'N/A (Uses token transfer or allowance spend)',
    database: 'public.payments.metadata->charge_id',
    backendApi: 'ChargeInput / StripeChargeResponse',
    clientUi: 'CheckoutForm submission state',
    sdk: 'ChargeRequest',
    notes: 'Fiat gateway charge attempt or web3 pull authorization',
  },
  settlement: {
    contract: 'payment-channel::settle method',
    database: 'public.pending_settlements',
    backendApi: 'PendingSettlement DTO',
    clientUi: 'SettlementStatusBadge',
    sdk: 'SettlementResponse',
    notes: 'Finalization of off-chain payment channel state onto Stellar ledger',
  },
  escrow: {
    contract: 'escrow contract struct',
    database: 'public.escrow_accounts / public.contract_events',
    backendApi: 'EscrowDetails DTO',
    clientUi: 'EscrowBalanceCard',
    sdk: 'Escrow Interface',
    notes: 'Locked token deposit on-chain awaiting release criteria',
  },
  channel: {
    contract: 'payment-channel contract instance',
    database: 'public.payment_channels & public.channel_states',
    backendApi: 'PaymentChannel & ChannelState DTOs',
    clientUi: 'ChannelBalanceWidget',
    sdk: 'PaymentChannel Interface',
    notes: 'Two-party state channel for instant micro-fee subscription renewals',
  },
  card: {
    contract: 'virtual-card contract',
    database: 'public.subscriptions.credit_card_required & virtual card tables',
    backendApi: 'VirtualCard DTO',
    clientUi: 'VirtualCardPreview & PaymentMethodSelector',
    sdk: 'VirtualCard Interface',
    notes: 'Distinguishes web3 virtual cards from traditional fiat credit cards',
  },
  gift_card: {
    contract: 'voucher-ledger contract',
    database: 'public.subscription_gift_cards & public.gift_card_ledger',
    backendApi: 'GiftCard & GiftCardLedgerEntry DTOs',
    clientUi: 'GiftCardRedeemForm',
    sdk: 'GiftCard Interface',
    notes: 'Pre-funded gift card balance tracked via immutable double-entry ledger',
  },
  stealth_payment: {
    contract: 'stealth-announcement contract',
    database: 'public.stealth_payments',
    backendApi: 'StealthPaymentRecord DTO',
    clientUi: 'PrivacyToggle & StealthStatusIndicator',
    sdk: 'StealthPayment Interface',
    notes: 'Privacy-preserving renewal payments using ephemeral keypairs',
  },
};

/**
 * State Machines & Transition Rules
 */

export type CanonicalSubscriptionState = 'active' | 'trial' | 'paused' | 'cancelled' | 'expired';

export const VALID_SUBSCRIPTION_TRANSITIONS: Record<CanonicalSubscriptionState, CanonicalSubscriptionState[]> = {
  active: ['paused', 'cancelled', 'expired'],
  trial: ['active', 'expired', 'cancelled'],
  paused: ['active', 'cancelled'],
  cancelled: [],
  expired: ['active'],
};

export type CanonicalRenewalState =
  | 'scheduled'
  | 'cooldown'
  | 'pending_approval'
  | 'approved'
  | 'executing'
  | 'settled'
  | 'failed'
  | 'dead_lettered';

export const VALID_RENEWAL_TRANSITIONS: Record<CanonicalRenewalState, CanonicalRenewalState[]> = {
  scheduled: ['cooldown'],
  cooldown: ['pending_approval', 'executing'],
  pending_approval: ['approved', 'failed'],
  approved: ['executing'],
  executing: ['settled', 'failed'],
  failed: ['scheduled', 'dead_lettered'],
  settled: [],
  dead_lettered: [],
};

export type CanonicalChannelStatus = 'opening' | 'open' | 'disputed' | 'closing' | 'closed';

export const VALID_CHANNEL_TRANSITIONS: Record<CanonicalChannelStatus, CanonicalChannelStatus[]> = {
  opening: ['open'],
  open: ['closing', 'disputed'],
  disputed: ['closing'],
  closing: ['closed'],
  closed: [],
};

export type CanonicalSettlementStatus = 'pending' | 'submitted' | 'confirmed' | 'rejected';

export type CanonicalGiftCardLedgerStatus =
  | 'issued'
  | 'active'
  | 'partially_redeemed'
  | 'fully_redeemed'
  | 'expired'
  | 'voided';

/**
 * Validates whether a state transition is permitted under canonical state machine rules
 */
export function isValidSubscriptionTransition(
  fromState: CanonicalSubscriptionState,
  toState: CanonicalSubscriptionState,
): boolean {
  return VALID_SUBSCRIPTION_TRANSITIONS[fromState]?.includes(toState) ?? false;
}

export function isValidRenewalTransition(
  fromState: CanonicalRenewalState,
  toState: CanonicalRenewalState,
): boolean {
  return VALID_RENEWAL_TRANSITIONS[fromState]?.includes(toState) ?? false;
}
