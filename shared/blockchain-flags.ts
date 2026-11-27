/**
 * shared/blockchain-flags.ts
 *
 * Single source of truth for blockchain / Stellar network feature flags,
 * explorer URL generation, and network-aware utilities.
 *
 * These flags are consumed by both the backend (Node.js) and the client
 * (Next.js / browser) via their respective environment-variable namespaces.
 *
 * Backend env vars  → process.env.*
 * Client public vars → process.env.NEXT_PUBLIC_*
 *
 * Flag summary
 * ─────────────────────────────────────────────────────────────────────────────
 * ENABLE_TESTNET_ACTIONS   Allow testnet-only operations (faucet, friendbot,
 *                          testnet contract calls, etc.).  Must be explicitly
 *                          set to "true"; defaults to false in production.
 *
 * ENABLE_BLOCKCHAIN        Master switch for all on-chain writes.  When false
 *                          the app falls back to database-only logging.
 *
 * STELLAR_NETWORK          Active Stellar network: "testnet" | "mainnet" |
 *                          "futurenet".  Drives RPC endpoint selection and
 *                          network passphrase resolution.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet';

// ─── Explorer URL Templates ──────────────────────────────────────────────────

const EXPLORER_BASE_URLS: Record<StellarNetwork, string> = {
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

const EXPLORER_FALLBACK = 'https://stellar.expert/explorer/public';

/**
 * Resolve the Stellar expert base URL for the given network.
 *
 * @param network - The Stellar network.  Defaults to the resolved active network.
 * @returns The base explorer URL (without trailing slash).
 */
export function resolveExplorerBase(network?: StellarNetwork): string {
  if (network) return EXPLORER_BASE_URLS[network] ?? EXPLORER_FALLBACK;
  const active = resolveStellarNetwork();
  return EXPLORER_BASE_URLS[active] ?? EXPLORER_FALLBACK;
}

/**
 * Build a network-aware transaction explorer URL.
 *
 * Usage:
 * ```ts
 * resolveExplorerUrl('abc123txhash') // → "https://stellar.expert/explorer/testnet/tx/abc123txhash"
 * resolveExplorerUrl('abc123txhash', 'mainnet') // → "https://stellar.expert/explorer/public/tx/abc123txhash"
 * ```
 *
 * Falls back to `resolveExplorerBase()` when `network` is omitted.
 *
 * @param txHash - The transaction hash to link to.
 * @param network - Optional explicit network.  Defaults to the active network.
 * @returns The full explorer URL for the transaction.
 */
export function resolveExplorerUrl(txHash: string, network?: StellarNetwork): string {
  const base = resolveExplorerBase(network);
  return `${base}/tx/${txHash}`;
}

/**
 * Build a network-aware account explorer URL.
 *
 * @param publicKey - The Stellar public key to link to.
 * @param network - Optional explicit network.  Defaults to the active network.
 * @returns The full explorer URL for the account.
 */
export function resolveAccountExplorerUrl(publicKey: string, network?: StellarNetwork): string {
  const base = resolveExplorerBase(network);
  return `${base}/account/${publicKey}`;
}

export interface BlockchainFlags {
  /** Whether testnet-only actions are permitted in this environment. */
  testnetActionsEnabled: boolean;
  /** Master switch: whether on-chain writes are enabled at all. */
  blockchainEnabled: boolean;
  /** The active Stellar network. */
  network: StellarNetwork;
  /** Whether the current environment is production. */
  isProduction: boolean;
}

/**
 * Resolve the active Stellar network from environment variables.
 *
 * Checks both the backend var (`STELLAR_NETWORK`) and the client public var
 * (`NEXT_PUBLIC_STELLAR_NETWORK`) so this helper works in both runtimes.
 */
export function resolveStellarNetwork(): StellarNetwork {
  const raw =
    (typeof process !== 'undefined' &&
      (process.env.STELLAR_NETWORK ||
        process.env.NEXT_PUBLIC_STELLAR_NETWORK)) ||
    '';

  const normalised = raw.trim().toLowerCase();
  if (normalised === 'mainnet' || normalised === 'public') return 'mainnet';
  if (normalised === 'futurenet') return 'futurenet';
  // Default to testnet only when not in production
  return 'testnet';
}

/**
 * Evaluate all blockchain feature flags from the current environment.
 *
 * This function is intentionally side-effect-free and reads `process.env`
 * directly so it can be called at module initialisation time in both Node
 * and browser (Next.js) contexts.
 */
export function getBlockchainFlags(): BlockchainFlags {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const network = resolveStellarNetwork();

  // ENABLE_TESTNET_ACTIONS must be explicitly opted-in.
  // In production it is ALWAYS false unless the operator has deliberately
  // set the flag — and even then we only honour it on non-mainnet networks.
  const testnetActionsRaw =
    process.env.ENABLE_TESTNET_ACTIONS ??
    process.env.NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS ??
    'false';

  const testnetActionsEnabled =
    testnetActionsRaw === 'true' && network !== 'mainnet';

  // ENABLE_BLOCKCHAIN defaults to true when a contract address is present,
  // false otherwise.  Operators can force-disable with ENABLE_BLOCKCHAIN=false.
  const blockchainRaw =
    process.env.ENABLE_BLOCKCHAIN ??
    process.env.NEXT_PUBLIC_ENABLE_BLOCKCHAIN ??
    'true';

  const blockchainEnabled = blockchainRaw !== 'false';

  return {
    testnetActionsEnabled,
    blockchainEnabled,
    network,
    isProduction,
  };
}

/**
 * Assert that testnet-only actions are permitted in the current environment.
 *
 * Throws a descriptive error when called in a context where testnet actions
 * are not allowed (e.g. production builds, mainnet network).
 *
 * @param actionName – Human-readable name of the action being guarded.
 */
export function assertTestnetAllowed(actionName: string): void {
  const flags = getBlockchainFlags();

  if (!flags.testnetActionsEnabled) {
    const reason = flags.network === 'mainnet'
      ? 'testnet actions are not permitted on mainnet'
      : flags.isProduction
        ? 'ENABLE_TESTNET_ACTIONS is not set to true in this production environment'
        : 'ENABLE_TESTNET_ACTIONS is not enabled';

    throw new Error(
      `[blockchain] Testnet-only action "${actionName}" was rejected: ${reason}. ` +
        'Set ENABLE_TESTNET_ACTIONS=true (non-mainnet only) to allow this action.',
    );
  }
}

/**
 * Assert that on-chain writes are enabled.
 *
 * Throws when the blockchain master switch is off.
 *
 * @param actionName – Human-readable name of the action being guarded.
 */
export function assertBlockchainEnabled(actionName: string): void {
  const flags = getBlockchainFlags();

  if (!flags.blockchainEnabled) {
    throw new Error(
      `[blockchain] Action "${actionName}" requires on-chain writes, but ` +
        'ENABLE_BLOCKCHAIN is set to false. Remove the flag or set it to true.',
    );
  }
}

/**
 * Assert that the active network matches the expected network.
 *
 * Useful for guarding deploy scripts and admin operations that must only
 * run against a specific network.
 *
 * @param expected  – The network that must be active.
 * @param actionName – Human-readable name of the action being guarded.
 */
export function assertNetwork(
  expected: StellarNetwork,
  actionName: string,
): void {
  const { network } = getBlockchainFlags();

  if (network !== expected) {
    throw new Error(
      `[blockchain] Action "${actionName}" requires network "${expected}" ` +
        `but the active network is "${network}". ` +
        `Set STELLAR_NETWORK=${expected} to proceed.`,
    );
  }
}
