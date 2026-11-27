import { AgentRegistryReader } from './scope-enforcer';
import { AgentRegistryGrant } from './types';

/**
 * Raw record as returned by the `agent-registry` contract.
 *
 * - `scopeMask`: the on-chain `u32` scope bitmask.
 * - `expiresAtSec`: on-chain `get_expiry` result, a ledger timestamp in
 *   SECONDS since the Unix epoch, or `null` when the authority never expires.
 */
export interface OnChainAgentRecord {
  scopeMask: number;
  expiresAtSec: bigint | number | null;
}

/** Thin transport seam so the reader can be tested without an RPC node. */
export interface OnChainAgentSource {
  /** Resolve to `null` when the agent is not registered (never registered or revoked). */
  getAgent(agentId: string): Promise<OnChainAgentRecord | null>;
}

/** Bit order matches `ScopeSet` in contracts/agent-registry (bit 0, 1, 2). */
export const DEFAULT_SCOPE_NAMES = ['renewals', 'giftcards', 'approvals'] as const;

/** Convert an on-chain expiry (seconds) into the grant model's ISO string. */
export function expiryToIso(expiresAtSec: bigint | number | null): string | null {
  if (expiresAtSec === null || expiresAtSec === undefined) {
    return null;
  }
  const seconds = typeof expiresAtSec === 'bigint' ? Number(expiresAtSec) : expiresAtSec;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`invalid on-chain expiry: ${String(expiresAtSec)}`);
  }
  return new Date(seconds * 1000).toISOString();
}

export function scopeMaskToScopes(
  mask: number,
  names: readonly string[] = DEFAULT_SCOPE_NAMES,
): string[] {
  return names.filter((_, bit) => (mask & (1 << bit)) !== 0);
}

/**
 * Reads grants from the on-chain agent registry and maps the on-chain expiry
 * into `AgentRegistryGrant.expiresAt`, so `ScopeEnforcer` rejects expired
 * agents with `grant_expired`.
 *
 * Revocation removes the on-chain entry, so a missing record surfaces as an
 * error (the enforcer fails closed on any reader error).
 */
export class OnChainAgentRegistryReader implements AgentRegistryReader {
  constructor(
    private readonly source: OnChainAgentSource,
    private readonly scopeNames: readonly string[] = DEFAULT_SCOPE_NAMES,
  ) {}

  async getGrant(agentId: string): Promise<AgentRegistryGrant> {
    const record = await this.source.getAgent(agentId);
    if (!record) {
      throw new Error('grant not found');
    }
    return {
      agentId,
      scopes: scopeMaskToScopes(record.scopeMask, this.scopeNames),
      expiresAt: expiryToIso(record.expiresAtSec),
      revokedAt: null,
    };
  }
}
