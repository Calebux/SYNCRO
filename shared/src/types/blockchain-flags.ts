/**
 * Privacy Feature Flags
 * Defines global and per-user feature flags for the privacy and encryption suite.
 */

export const PRIVACY_STEALTH_ADDRESSES = 'PRIVACY_STEALTH_ADDRESSES';
export const PRIVACY_ENCRYPT_ON_CHAIN = 'PRIVACY_ENCRYPT_ON_CHAIN';
export const PRIVACY_ZK_PROOFS = 'PRIVACY_ZK_PROOFS';
export const PRIVACY_PAYMENT_CHANNELS = 'PRIVACY_PAYMENT_CHANNELS';
export const PRIVACY_REMINDER_JITTER = 'PRIVACY_REMINDER_JITTER';
export const PRIVACY_AUDIT_COMMITMENTS = 'PRIVACY_AUDIT_COMMITMENTS';
export const PRIVACY_SETTLEMENT_BATCHING = 'PRIVACY_SETTLEMENT_BATCHING';

export type PrivacyFlag =
  | typeof PRIVACY_STEALTH_ADDRESSES
  | typeof PRIVACY_ENCRYPT_ON_CHAIN
  | typeof PRIVACY_ZK_PROOFS
  | typeof PRIVACY_PAYMENT_CHANNELS
  | typeof PRIVACY_REMINDER_JITTER
  | typeof PRIVACY_AUDIT_COMMITMENTS
  | typeof PRIVACY_SETTLEMENT_BATCHING;

export interface PrivacyFlagInfo {
  name: PrivacyFlag;
  default: boolean;
  scope: 'global' | 'per-user';
}

export const PRIVACY_FLAGS_CONFIG: Record<PrivacyFlag, PrivacyFlagInfo> = {
  [PRIVACY_STEALTH_ADDRESSES]: {
    name: PRIVACY_STEALTH_ADDRESSES,
    default: false,
    scope: 'per-user',
  },
  [PRIVACY_ENCRYPT_ON_CHAIN]: {
    name: PRIVACY_ENCRYPT_ON_CHAIN,
    default: false,
    scope: 'per-user',
  },
  [PRIVACY_ZK_PROOFS]: {
    name: PRIVACY_ZK_PROOFS,
    default: false,
    scope: 'global',
  },
  [PRIVACY_PAYMENT_CHANNELS]: {
    name: PRIVACY_PAYMENT_CHANNELS,
    default: false,
    scope: 'per-user',
  },
  [PRIVACY_REMINDER_JITTER]: {
    name: PRIVACY_REMINDER_JITTER,
    default: false,
    scope: 'per-user',
  },
  [PRIVACY_AUDIT_COMMITMENTS]: {
    name: PRIVACY_AUDIT_COMMITMENTS,
    default: false,
    scope: 'global',
  },
  [PRIVACY_SETTLEMENT_BATCHING]: {
    name: PRIVACY_SETTLEMENT_BATCHING,
    default: false,
    scope: 'global',
  },
};
