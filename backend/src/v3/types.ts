export type ProviderMode = 'staging' | 'production';

export interface ProviderRegistration {
  providerId: string;
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
  payoutVerified: boolean;
  payoutChallenge: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredRoute {
  routeId: string;
  providerId: string;
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
  scopeKey: string;
  createdAt: string;
}

/**
 * A published price for one route. Versions are append-only: a later version
 * does not rewrite an earlier one, and a call is priced by the version whose
 * `effectiveFrom` was already in the past when the call was metered.
 */
export interface RateCardVersion {
  versionId: string;
  providerId: string;
  routeId: string;
  sequence: number;
  label: string;
  price: number;
  unit: string;
  quantityExtractor: string;
  pathPattern: string;
  method: string;
  effectiveFrom: string;
  createdAt: string;
}

export interface ProviderRouteView extends RegisteredRoute {
  /** Version that prices calls metered at `applicableAt`. */
  applicableVersion: RateCardVersion | null;
}

export type SettlementStatus = 'settled' | 'unsettled' | 'in_dispute';

export interface ProviderSettlement {
  settlementId: string;
  providerId: string;
  routeId: string;
  receiptId: string;
  method: string;
  pathPattern: string;
  unit: string;
  quantity: number;
  /** Unit price of the rate-card version that applied when the call was metered. */
  price: number;
  amount: number;
  rateCardVersion: string;
  rateCardEffectiveFrom: string;
  status: SettlementStatus;
  meteredAt: string;
  channelId: string;
}

/** Three buckets, kept separate. There is no combined total. */
export interface ProviderRevenue {
  settled: number;
  unsettled: number;
  inDispute: number;
}

export interface AgentRegistryGrant {
  agentId: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ScopeCheckRequest {
  agentId: string;
  routeScope: string;
}

export type ScopeRejectionCode =
  | 'missing_scope'
  | 'grant_expired'
  | 'grant_revoked'
  | 'registry_unavailable';

export class ScopeRejectionError extends Error {
  readonly code: ScopeRejectionCode;

  constructor(code: ScopeRejectionCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PaidReceiptPayload {
  receiptId: string;
  requestHash: string;
  route: string;
  unit: string;
  quantity: number;
  amount: number;
  rateCardVersion: string;
  exchangeRate: number | null;
  channelId: string;
  stateNonce: number;
  timestamp: string;
  signerPublicKey: string;
}

export interface PaidReceipt extends PaidReceiptPayload {
  signature: string;
}

