/**
 * Re-export generated contract interfaces for existing import paths.
 * Source of truth: src/generated/soroban-abi.json
 */
<<<<<<< HEAD:shared/src/logic/soroban-contract-interfaces.ts

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
      {
        name: 'record_commitment',
        args: ['BytesN32'],
      },
      {
        name: 'add_writer',
        args: ['Address'],
      },
      {
        name: 'remove_writer',
        args: ['Address'],
      },
      {
        name: 'is_writer',
        args: ['Address'],
      },
      {
        name: 'get_writers',
        args: [],
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
=======
export * from './generated/contracts';
>>>>>>> refs/pr/1340:shared/src/soroban-contract-interfaces.ts
