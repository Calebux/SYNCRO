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

