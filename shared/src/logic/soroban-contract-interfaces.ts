/**
 * Canonical Soroban contract function signatures.
 *
 * Source of truth: Rust contract implementations under contracts/contracts/.
 * Keep in sync with docs/contracts.mdx. Backend bindings must reference only
 * functions declared here — drift is caught by contract-interface-drift.test.ts.
 */

/** Soroban ScVal argument kinds (subset used by SYNCRO contracts). */
export type SorobanArgKind =
  | 'Address'
  | 'String'
  | 'U64'
  | 'I128'
  | 'BytesN32'
  | 'Bool'
  | 'Option'
  | 'Vec';

export interface SorobanContractFunction {
  /** Soroban export name (snake_case). */
  name: string;
  /** Ordered argument kinds as declared in the Rust contract. */
  args: SorobanArgKind[];
}

export interface SorobanContractInterface {
  /** Human-readable contract name. */
  contract: string;
  /** Rust source file path (for maintainers). */
  source: string;
  functions: SorobanContractFunction[];
}

/**
 * Deployed contract interfaces the backend must stay compatible with.
 * Only include functions the backend invokes or will invoke.
 */
export const SOROBAN_CONTRACT_INTERFACES: SorobanContractInterface[] = [
  {
    contract: 'SubscriptionRegistry',
    source: 'contracts/contracts/src/subscription_registry.rs',
    functions: [
      {
        name: 'create_subscription',
        args: ['Address', 'String', 'U64', 'I128', 'U64'],
      },
      {
        name: 'update_subscription',
        args: ['BytesN32', 'Address', 'Option', 'Option', 'Option', 'Option'],
      },
      {
        name: 'cancel_subscription',
        args: ['BytesN32', 'Address'],
      },
    ],
  },
  {
    contract: 'SubscriptionLogging',
    source: 'contracts/contracts/subscription_logging/src/lib.rs',
    functions: [
      {
        name: 'record_log',
        args: ['U64', 'String', 'String'],
      },
    ],
  },
  {
    contract: 'SubscriptionRenewal',
    source: 'contracts/contracts/subscription_renewal/src/lib.rs',
    functions: [
      {
        name: 'renew',
        args: [
          'Address',
          'U64',
          'U64',
          'I128',
          'U64',
          'U64',
          'U64',
          'Bool',
        ],
      },
    ],
  },
];

/** Lookup a function definition by contract name and Soroban method name. */
export function findContractFunction(
  contract: string,
  method: string,
): SorobanContractFunction | undefined {
  const iface = SOROBAN_CONTRACT_INTERFACES.find((c) => c.contract === contract);
  return iface?.functions.find((fn) => fn.name === method);
}

/** Flat set of all declared Soroban method names (for quick membership checks). */
export function allContractMethodNames(): Set<string> {
  const names = new Set<string>();
  for (const iface of SOROBAN_CONTRACT_INTERFACES) {
    for (const fn of iface.functions) {
      names.add(fn.name);
    }
  }
  return names;
}
