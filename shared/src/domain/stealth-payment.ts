/**
 * Stealth payment types for unlinkable on-chain subscription renewals.
 * Hand-written domain types (not generated from schema or ABI).
 */

export interface StealthPaymentRecord {
  subscriptionId: string;
  approvalId: string;
  stealthAddress: string;
  ephemeralPubkey: string;
  amount: number;
  cycleId: string;
  createdAt: string;
  transactionHash?: string;
}

export interface StealthMetaAddressKeys {
  spendingPubkey: string;
  viewingPubkey: string;
}

export interface StealthRenewalContext {
  enabled: boolean;
  metaAddress?: StealthMetaAddressKeys;
  paymentAddress?: string;
  ephemeralPubkey?: string;
}
